import { useState, useCallback } from 'react';
import type { AnalysisRequest } from '@method-studio/analysis-specs';
import type { TypedOutputBlock, TableBlock } from '@method-studio/output-renderer';
import {
  formatStatistic,
  formatDF,
  formatPValue,
  formatEffectSize,
  formatNumber,
} from '@method-studio/output-renderer';

interface UseTTestReturn {
  run: (request: AnalysisRequest) => Promise<void>;
  isRunning: boolean;
  outputBlocks: TypedOutputBlock[];
  error: string | null;
  clearOutput: () => void;
}

export function useTTest(
  dataRows: Record<string, unknown>[],
): UseTTestReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [outputBlocks, setOutputBlocks] = useState<TypedOutputBlock[]>([]);
  const [error, setError] = useState<string | null>(null);

  const clearOutput = useCallback(() => {
    setOutputBlocks([]);
    setError(null);
  }, []);

  const run = useCallback(
    async (request: AnalysisRequest) => {
      setIsRunning(true);
      setError(null);

      try {
        const blocks: TypedOutputBlock[] = [];
        const { specId, variables, options } = request;
        const confidenceLevel = (options['confidenceLevel'] as number) ?? 0.95;
        const alpha = 1 - confidenceLevel;

        // Convert variables to expected format for local t-test functions
        const varsRecord: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(variables)) {
          varsRecord[key] = Array.isArray(value) ? value : [];
        }

        if (specId === 'ttest-one-sample') {
          blocks.push(...runOneSample(varsRecord, options, dataRows, alpha));
        } else if (specId === 'ttest-independent') {
          blocks.push(...runIndependent(varsRecord, options, dataRows, alpha));
        } else if (specId === 'ttest-paired') {
          blocks.push(...runPaired(varsRecord, options, dataRows, alpha));
        }

        setOutputBlocks(prev => [...prev, ...blocks]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setOutputBlocks(prev => [
          ...prev,
          {
            id: `ttest-error-${Date.now()}`,
            type: 'error',
            content: `T-test error: ${msg}`,
            timestamp: new Date(),
            source: 'ttest',
          },
        ]);
      } finally {
        setIsRunning(false);
      }
    },
    [dataRows],
  );

  return { run, isRunning, outputBlocks, error, clearOutput };
}

// ---------------------------------------------------------------------------
// One-Sample T-Test
// ---------------------------------------------------------------------------

function runOneSample(
  variables: Record<string, string[]>,
  options: Record<string, unknown>,
  dataRows: Record<string, unknown>[],
  alpha: number,
): TypedOutputBlock[] {
  const blocks: TypedOutputBlock[] = [];
  const testValue = (options['testValue'] as number) ?? 0;
  const showEffect = Boolean(options['effectSize']);
  const testVarNames = variables['testVariables'] ?? [];

  blocks.push({
    id: `ttest-one-title-${Date.now()}`,
    type: 'title',
    content: 'One-Sample T Test',
    timestamp: new Date(),
    source: 'ttest',
  });

  const headers = ['Variable', 'N', 'Mean', 'Std. Deviation', 'Std. Error Mean'];
  const statHeaders = [
    'Variable', 't', 'df', 'Sig. (2-tailed)',
    'Mean Difference', `${((1 - alpha) * 100).toFixed(0)}% CI Lower`,
    `${((1 - alpha) * 100).toFixed(0)}% CI Upper`,
  ];
  if (showEffect) statHeaders.push("Cohen's d");

  const descRows: (string | number | null)[][] = [];
  const statRows: (string | number | null)[][] = [];

  for (const varName of testVarNames) {
    const values = extractNumericValues(dataRows, varName);
    if (values.length < 2) {
      statRows.push([varName, ...Array(statHeaders.length - 1).fill('\u2014') as string[]]);
      continue;
    }

    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
    const stdDev = Math.sqrt(variance);
    const stdErr = stdDev / Math.sqrt(n);
    const meanDiff = mean - testValue;
    const t = meanDiff / stdErr;
    const df = n - 1;
    const p = twoTailedP(t, df);
    const tCrit = tCritical(alpha / 2, df);
    const ciLower = meanDiff - tCrit * stdErr;
    const ciUpper = meanDiff + tCrit * stdErr;

    descRows.push([
      varName,
      n,
      parseFloat(formatNumber(mean, 3)),
      parseFloat(formatNumber(stdDev, 3)),
      parseFloat(formatNumber(stdErr, 3)),
    ]);

    const statRow: (string | number | null)[] = [
      varName,
      parseFloat(formatStatistic(t)),
      parseFloat(formatDF(df)),
      formatPValue(p),
      parseFloat(formatNumber(meanDiff, 3)),
      parseFloat(formatNumber(ciLower, 3)),
      parseFloat(formatNumber(ciUpper, 3)),
    ];
    if (showEffect) {
      const d = meanDiff / stdDev;
      statRow.push(parseFloat(formatEffectSize(d)));
    }
    statRows.push(statRow);
  }

  blocks.push({
    id: `ttest-one-desc-${Date.now()}`,
    type: 'table',
    content: { title: 'One-Sample Statistics', headers, rows: descRows },
    timestamp: new Date(),
    source: 'ttest',
  } as TableBlock);

  blocks.push({
    id: `ttest-one-stat-${Date.now()}`,
    type: 'table',
    content: {
      title: 'One-Sample Test',
      headers: statHeaders,
      rows: statRows,
      footnotes: [`Test Value = ${testValue}`],
    },
    timestamp: new Date(),
    source: 'ttest',
  } as TableBlock);

  return blocks;
}

// ---------------------------------------------------------------------------
// Independent-Samples T-Test
// ---------------------------------------------------------------------------

function runIndependent(
  variables: Record<string, string[]>,
  options: Record<string, unknown>,
  dataRows: Record<string, unknown>[],
  alpha: number,
): TypedOutputBlock[] {
  const blocks: TypedOutputBlock[] = [];
  const groupVar = (variables['groupingVariable'] ?? [])[0];
  const testVarNames = variables['testVariables'] ?? [];
  const showEffect = Boolean(options['effectSize']);
  const showLevene = Boolean(options['leveneTest'] ?? true);
  const g1 = options['group1Value'] as number ?? 1;
  const g2 = options['group2Value'] as number ?? 2;

  if (!groupVar) {
    return [{
      id: `ttest-ind-error-${Date.now()}`,
      type: 'error',
      content: 'No grouping variable specified.',
      timestamp: new Date(),
      source: 'ttest',
    }];
  }

  blocks.push({
    id: `ttest-ind-title-${Date.now()}`,
    type: 'title',
    content: 'Independent-Samples T Test',
    timestamp: new Date(),
    source: 'ttest',
  });

  const descHeaders = ['Variable', 'Group', 'N', 'Mean', 'Std. Deviation', 'Std. Error Mean'];
  const descRows: (string | number | null)[][] = [];

  const ciLabel = `${((1 - alpha) * 100).toFixed(0)}%`;
  const statHeaders = [
    'Variable',
    ...(showLevene ? ["Levene's F", "Levene's Sig."] : []),
    't', 'df', 'Sig. (2-tailed)', 'Mean Difference',
    'Std. Error Difference',
    `${ciLabel} CI Lower`, `${ciLabel} CI Upper`,
  ];
  if (showEffect) statHeaders.push("Cohen's d");

  const statRows: (string | number | null)[][] = [];

  for (const varName of testVarNames) {
    const group1 = extractNumericValuesByGroup(dataRows, varName, groupVar, g1);
    const group2 = extractNumericValuesByGroup(dataRows, varName, groupVar, g2);

    // Descriptive rows
    [{ vals: group1, label: String(g1) }, { vals: group2, label: String(g2) }].forEach(
      ({ vals, label }) => {
        const n = vals.length;
        const mean = n ? vals.reduce((a, b) => a + b, 0) / n : 0;
        const stdDev = n > 1 ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
        descRows.push([varName, label, n, parseFloat(formatNumber(mean, 3)), parseFloat(formatNumber(stdDev, 3)), parseFloat(formatNumber(stdDev / Math.sqrt(n), 3))]);
      },
    );

    if (group1.length < 2 || group2.length < 2) {
      statRows.push([varName, ...Array(statHeaders.length - 1).fill('\u2014') as string[]]);
      continue;
    }

    const n1 = group1.length, n2 = group2.length;
    const mean1 = group1.reduce((a, b) => a + b, 0) / n1;
    const mean2 = group2.reduce((a, b) => a + b, 0) / n2;
    const var1 = group1.reduce((a, v) => a + (v - mean1) ** 2, 0) / (n1 - 1);
    const var2 = group2.reduce((a, v) => a + (v - mean2) ** 2, 0) / (n2 - 1);

    // Welch t-test (unequal variances)
    const t = (mean1 - mean2) / Math.sqrt(var1 / n1 + var2 / n2);
    const welchDF = (var1 / n1 + var2 / n2) ** 2 /
      ((var1 / n1) ** 2 / (n1 - 1) + (var2 / n2) ** 2 / (n2 - 1));
    const p = twoTailedP(t, welchDF);
    const meanDiff = mean1 - mean2;
    const stdErrDiff = Math.sqrt(var1 / n1 + var2 / n2);
    const tCrit = tCritical(alpha / 2, welchDF);
    const ciLower = meanDiff - tCrit * stdErrDiff;
    const ciUpper = meanDiff + tCrit * stdErrDiff;

    const leveneF = computeLeveneF(group1, group2);
    const leveneP = twoTailedP(Math.sqrt(leveneF), n1 + n2 - 2);

    const statRow: (string | number | null)[] = [varName];
    if (showLevene) {
      statRow.push(parseFloat(formatNumber(leveneF, 3)));
      statRow.push(formatPValue(leveneP));
    }
    statRow.push(
      parseFloat(formatStatistic(t)),
      parseFloat(formatDF(welchDF)),
      formatPValue(p),
      parseFloat(formatNumber(meanDiff, 3)),
      parseFloat(formatNumber(stdErrDiff, 3)),
      parseFloat(formatNumber(ciLower, 3)),
      parseFloat(formatNumber(ciUpper, 3)),
    );
    if (showEffect) {
      const pooledSD = Math.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2));
      const d = pooledSD > 0 ? meanDiff / pooledSD : 0;
      statRow.push(parseFloat(formatEffectSize(d)));
    }
    statRows.push(statRow);
  }

  blocks.push({
    id: `ttest-ind-desc-${Date.now()}`,
    type: 'table',
    content: { title: 'Group Statistics', headers: descHeaders, rows: descRows },
    timestamp: new Date(),
    source: 'ttest',
  } as TableBlock);

  blocks.push({
    id: `ttest-ind-stat-${Date.now()}`,
    type: 'table',
    content: {
      title: 'Independent Samples Test',
      headers: statHeaders,
      rows: statRows,
      footnotes: ['Welch t-test (assumes unequal variances) reported.'],
    },
    timestamp: new Date(),
    source: 'ttest',
  } as TableBlock);

  return blocks;
}

// ---------------------------------------------------------------------------
// Paired-Samples T-Test
// ---------------------------------------------------------------------------

function runPaired(
  variables: Record<string, string[]>,
  options: Record<string, unknown>,
  dataRows: Record<string, unknown>[],
  alpha: number,
): TypedOutputBlock[] {
  const blocks: TypedOutputBlock[] = [];
  const var1Name = (variables['variable1'] ?? [])[0];
  const var2Name = (variables['variable2'] ?? [])[0];
  const showEffect = Boolean(options['effectSize']);

  if (!var1Name || !var2Name) {
    return [{
      id: `ttest-paired-error-${Date.now()}`,
      type: 'error',
      content: 'Two variables are required for paired t-test.',
      timestamp: new Date(),
      source: 'ttest',
    }];
  }

  blocks.push({
    id: `ttest-paired-title-${Date.now()}`,
    type: 'title',
    content: 'Paired-Samples T Test',
    timestamp: new Date(),
    source: 'ttest',
  });

  const pairs: [number, number][] = dataRows
    .map(r => [r[var1Name], r[var2Name]] as [unknown, unknown])
    .filter((p): p is [number, number] => typeof p[0] === 'number' && typeof p[1] === 'number');

  const n = pairs.length;

  // Descriptive stats table
  const descHeaders = ['', 'Mean', 'N', 'Std. Deviation', 'Std. Error Mean'];
  const descRows: (string | number | null)[][] = [];

  for (const [varName, vals] of [
    [var1Name, pairs.map(p => p[0])],
    [var2Name, pairs.map(p => p[1])],
  ] as [string, number[]][]) {
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const stdDev = n > 1 ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
    descRows.push([varName, parseFloat(formatNumber(mean, 3)), n, parseFloat(formatNumber(stdDev, 3)), parseFloat(formatNumber(stdDev / Math.sqrt(n), 3))]);
  }

  blocks.push({
    id: `ttest-paired-desc-${Date.now()}`,
    type: 'table',
    content: { title: 'Paired Samples Statistics', headers: descHeaders, rows: descRows },
    timestamp: new Date(),
    source: 'ttest',
  } as TableBlock);

  if (n < 2) {
    blocks.push({
      id: `ttest-paired-warn-${Date.now()}`,
      type: 'warning',
      content: 'Insufficient paired cases to compute t-test.',
      timestamp: new Date(),
      source: 'ttest',
    });
    return blocks;
  }

  const diffs = pairs.map(p => p[0] - p[1]);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / n;
  const stdDiff = Math.sqrt(diffs.reduce((a, v) => a + (v - meanDiff) ** 2, 0) / (n - 1));
  const stdErrDiff = stdDiff / Math.sqrt(n);
  const t = meanDiff / stdErrDiff;
  const df = n - 1;
  const p = twoTailedP(t, df);
  const tCrit = tCritical(alpha / 2, df);
  const ciLower = meanDiff - tCrit * stdErrDiff;
  const ciUpper = meanDiff + tCrit * stdErrDiff;
  const ciLabel = `${((1 - alpha) * 100).toFixed(0)}%`;

  const statHeaders = [
    'Pair', 'Mean', 'Std. Deviation', 'Std. Error Mean',
    `${ciLabel} CI Lower`, `${ciLabel} CI Upper`,
    't', 'df', 'Sig. (2-tailed)',
  ];
  if (showEffect) statHeaders.push("Cohen's d");

  const statRow: (string | number | null)[] = [
    `${var1Name} - ${var2Name}`,
    parseFloat(formatNumber(meanDiff, 3)),
    parseFloat(formatNumber(stdDiff, 3)),
    parseFloat(formatNumber(stdErrDiff, 3)),
    parseFloat(formatNumber(ciLower, 3)),
    parseFloat(formatNumber(ciUpper, 3)),
    parseFloat(formatStatistic(t)),
    parseFloat(formatDF(df)),
    formatPValue(p),
  ];
  if (showEffect) {
    statRow.push(parseFloat(formatEffectSize(meanDiff / stdDiff)));
  }

  const correlHeader = ['Pair', 'N', 'Correlation', 'Sig.'];
  const r = pearsonR(
    pairs.map(p => p[0]),
    pairs.map(p => p[1]),
  );
  const correlRows: (string | number | null)[][] = [
    [
      `${var1Name} & ${var2Name}`,
      n,
      parseFloat(formatEffectSize(r)),
      formatPValue(rToPValue(r, n)),
    ],
  ];

  blocks.push({
    id: `ttest-paired-correl-${Date.now()}`,
    type: 'table',
    content: { title: 'Paired Samples Correlations', headers: correlHeader, rows: correlRows },
    timestamp: new Date(),
    source: 'ttest',
  } as TableBlock);

  blocks.push({
    id: `ttest-paired-stat-${Date.now()}`,
    type: 'table',
    content: {
      title: 'Paired Samples Test',
      headers: statHeaders,
      rows: [statRow],
    },
    timestamp: new Date(),
    source: 'ttest',
  } as TableBlock);

  return blocks;
}

// ---------------------------------------------------------------------------
// Statistical helpers
// ---------------------------------------------------------------------------

function extractNumericValues(
  rows: Record<string, unknown>[],
  varName: string,
): number[] {
  return rows
    .map(r => r[varName])
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
}

function extractNumericValuesByGroup(
  rows: Record<string, unknown>[],
  varName: string,
  groupVar: string,
  groupVal: number | string,
): number[] {
  return rows
    .filter(r => r[groupVar] === groupVal || String(r[groupVar]) === String(groupVal))
    .map(r => r[varName])
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
}

/**
 * Approximate two-tailed p-value from t and df using normalisation approximation.
 * Sufficient for browser-side calculation; real analysis would use exact tables.
 */
function twoTailedP(t: number, df: number): number {
  const x = df / (df + t * t);
  const p = incompleteBetaRegularised(df / 2, 0.5, x);
  return Math.min(1, Math.max(0, p));
}

/**
 * Approximation of regularised incomplete beta function using continued fraction.
 * Accurate to ~4 significant figures for typical df values.
 */
function incompleteBetaRegularised(a: number, b: number, x: number): number {
  if (x < 0 || x > 1) return NaN;
  if (x === 0) return 0;
  if (x === 1) return 1;

  const lbeta = logGamma(a + b) - logGamma(a) - logGamma(b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;

  // Lentz continued fraction
  const MAX_ITER = 200;
  const EPS = 1e-10;
  let f = 1;
  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < EPS) d = EPS;
  d = 1 / d;
  f = d;

  for (let m = 1; m <= MAX_ITER; m++) {
    let numerator = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + numerator * d;
    c = 1 + numerator / c;
    if (Math.abs(d) < EPS) d = EPS;
    if (Math.abs(c) < EPS) c = EPS;
    d = 1 / d;
    f *= d * c;

    numerator = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    c = 1 + numerator / c;
    if (Math.abs(d) < EPS) d = EPS;
    if (Math.abs(c) < EPS) c = EPS;
    d = 1 / d;
    const delta = d * c;
    f *= delta;

    if (Math.abs(delta - 1) < EPS) break;
  }

  return front * f;
}

function logGamma(z: number): number {
  // Lanczos approximation
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953,
  ];
  let y = z;
  let x = z;
  const tmp = x + 5.5;
  const ser = c.reduce((acc, ci, i) => acc + ci / (y + i + 1), 1.000000000190015);
  return (
    Math.log(2.5066282746310005 * ser / x) + (x + 0.5) * Math.log(tmp) - tmp
  );
}

function tCritical(alpha: number, df: number): number {
  // Approximation using Wilson-Hilferty transformation
  const z = zFromP(alpha * 2);
  const h = 2 / (9 * df);
  return Math.cbrt(1 - h) * z + Math.cbrt(1 - h) - (1 - h);
}

function zFromP(p: number): number {
  // Rational approximation (Beasley-Springer-Moro)
  const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
  const b = [-8.4735109309, 23.08336743743, -21.06224101826, 3.13082909833];
  const c = [
    0.3374754822726869, 0.9761690190917186, 0.1607979714918209,
    0.0276438810333863, 0.0038405729373609, 0.0003951896511349,
    0.0000321767881768, 0.0000002888167364, 0.0000003960315187,
  ];

  const q = p - 0.5;
  if (Math.abs(q) <= 0.42) {
    const r = q * q;
    const num = a.reduce((s, ai, i) => s + ai * r ** i, 0);
    const den = b.reduce((s, bi, i) => s + bi * r ** (i + 1), 1);
    return q * num / den;
  }

  const r = q > 0 ? Math.log(-Math.log(1 - p)) : Math.log(-Math.log(p));
  let result = c.reduce((s, ci, i) => s + ci * r ** i, 0);
  if (q < 0) result = -result;
  return result;
}

function computeLeveneF(group1: number[], group2: number[]): number {
  const med1 = median(group1);
  const med2 = median(group2);
  const z1 = group1.map(v => Math.abs(v - med1));
  const z2 = group2.map(v => Math.abs(v - med2));
  const n = group1.length + group2.length;
  const grandMean = [...z1, ...z2].reduce((a, b) => a + b, 0) / n;
  const mean1 = z1.reduce((a, b) => a + b, 0) / z1.length;
  const mean2 = z2.reduce((a, b) => a + b, 0) / z2.length;
  const sst =
    z1.length * (mean1 - grandMean) ** 2 + z2.length * (mean2 - grandMean) ** 2;
  const sse =
    z1.reduce((a, v) => a + (v - mean1) ** 2, 0) +
    z2.reduce((a, v) => a + (v - mean2) ** 2, 0);
  return sst / (sse / (n - 2));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function pearsonR(x: number[], y: number[]): number {
  const n = x.length;
  if (n !== y.length || n < 2) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  const num = x.reduce((acc, xi, i) => acc + (xi - mx) * (y[i]! - my), 0);
  const dx = Math.sqrt(x.reduce((acc, xi) => acc + (xi - mx) ** 2, 0));
  const dy = Math.sqrt(y.reduce((acc, yi) => acc + (yi - my) ** 2, 0));
  return dx === 0 || dy === 0 ? 0 : num / (dx * dy);
}

function rToPValue(r: number, n: number): number {
  if (n <= 2) return 1;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return twoTailedP(t, n - 2);
}

