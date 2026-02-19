import { useState, useCallback } from 'react';
import type { AnalysisRequest } from '@method-studio/analysis-specs';
import type { TypedOutputBlock, TableBlock } from '@method-studio/output-renderer';
import { formatNumber, formatPercent, formatCount } from '@method-studio/output-renderer';

interface UseDescriptivesReturn {
  run: (request: AnalysisRequest) => Promise<void>;
  isRunning: boolean;
  outputBlocks: TypedOutputBlock[];
  error: string | null;
  clearOutput: () => void;
}

/**
 * Generate descriptive statistics entirely in-browser using the raw dataset rows.
 * When a real engine (R/Python) is connected, this hook will dispatch to it instead.
 */
export function useDescriptives(
  dataRows: Record<string, unknown>[],
): UseDescriptivesReturn {
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
        const opts = request.options;
        const rawVars = request.variables['variables'];
        const variableNames: string[] = Array.isArray(rawVars) ? rawVars : [];

        if (variableNames.length === 0) {
          throw new Error('No variables selected.');
        }

        // Title block
        blocks.push({
          id: `desc-title-${Date.now()}`,
          type: 'title',
          content: 'Descriptive Statistics',
          timestamp: new Date(),
          source: 'descriptives',
        });

        // Separate numeric vs string variables
        const numericVars: string[] = [];
        const stringVars: string[] = [];

        for (const v of variableNames as string[]) {
          const vals = dataRows.map(r => r[v]);
          const hasNumeric = vals.some(v2 => typeof v2 === 'number');
          if (hasNumeric) numericVars.push(v);
          else stringVars.push(v);
        }

        // ----------------------------------------------------------------
        // Statistics table for numeric variables
        // ----------------------------------------------------------------
        if (numericVars.length > 0) {
          const headers = buildStatHeaders(opts);
          const rows: (string | number | null)[][] = [];

          for (const varName of numericVars) {
            const raw = dataRows
              .map(r => r[varName])
              .filter((v2): v2 is number => typeof v2 === 'number' && !Number.isNaN(v2));

            rows.push(buildStatRow(varName, raw, opts));
          }

          const tableBlock: TableBlock = {
            id: `desc-table-${Date.now()}`,
            type: 'table',
            content: {
              title: 'Descriptive Statistics',
              headers,
              rows,
              footnotes: ['N = number of valid cases.'],
            },
            timestamp: new Date(),
            source: 'descriptives',
          };
          blocks.push(tableBlock);
        }

        // ----------------------------------------------------------------
        // Frequency tables for string / categorical variables
        // ----------------------------------------------------------------
        if (opts['frequencyTable'] && stringVars.length > 0) {
          for (const varName of stringVars) {
            const freq = buildFrequencyTable(varName, dataRows);
            blocks.push(freq);
          }
        }

        setOutputBlocks(prev => [...prev, ...blocks]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setOutputBlocks(prev => [
          ...prev,
          {
            id: `desc-error-${Date.now()}`,
            type: 'error',
            content: `Descriptive statistics error: ${msg}`,
            timestamp: new Date(),
            source: 'descriptives',
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
// Helpers
// ---------------------------------------------------------------------------

function buildStatHeaders(opts: Record<string, unknown>): string[] {
  const headers: string[] = ['Variable'];
  if (opts['validN']) headers.push('N');
  if (opts['mean']) headers.push('Mean');
  if (opts['semMean']) headers.push('Std. Error');
  if (opts['median']) headers.push('Median');
  if (opts['mode']) headers.push('Mode');
  if (opts['stdDev']) headers.push('Std. Deviation');
  if (opts['variance']) headers.push('Variance');
  if (opts['range']) headers.push('Range');
  if (opts['minimum']) headers.push('Minimum');
  if (opts['maximum']) headers.push('Maximum');
  if (opts['skewness']) headers.push('Skewness');
  if (opts['kurtosis']) headers.push('Kurtosis');
  return headers;
}

function buildStatRow(
  varName: string,
  values: number[],
  opts: Record<string, unknown>,
): (string | number | null)[] {
  const row: (string | number | null)[] = [varName];
  const n = values.length;

  if (n === 0) {
    // Fill with dashes
    const len = buildStatHeaders(opts).length - 1;
    return [varName, ...Array(len).fill('\u2014') as string[]];
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance =
    n > 1
      ? values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1)
      : 0;
  const stdDev = Math.sqrt(variance);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const range = max - min;
  const median = percentile(sorted, 50);

  if (opts['validN']) row.push(n);
  if (opts['mean']) row.push(parseFloat(formatNumber(mean, 3)));
  if (opts['semMean']) row.push(parseFloat(formatNumber(stdDev / Math.sqrt(n), 3)));
  if (opts['median']) row.push(parseFloat(formatNumber(median, 3)));
  if (opts['mode']) row.push(parseFloat(formatNumber(computeMode(values), 3)));
  if (opts['stdDev']) row.push(parseFloat(formatNumber(stdDev, 3)));
  if (opts['variance']) row.push(parseFloat(formatNumber(variance, 3)));
  if (opts['range']) row.push(parseFloat(formatNumber(range, 3)));
  if (opts['minimum']) row.push(parseFloat(formatNumber(min, 3)));
  if (opts['maximum']) row.push(parseFloat(formatNumber(max, 3)));

  if (opts['skewness']) {
    const skew = n > 2 ? computeSkewness(values, mean, stdDev, n) : null;
    row.push(skew !== null ? parseFloat(formatNumber(skew, 3)) : null);
  }
  if (opts['kurtosis']) {
    const kurt = n > 3 ? computeKurtosis(values, mean, stdDev, n) : null;
    row.push(kurt !== null ? parseFloat(formatNumber(kurt, 3)) : null);
  }

  return row;
}

function buildFrequencyTable(
  varName: string,
  dataRows: Record<string, unknown>[],
): TableBlock {
  const freq = new Map<string, number>();
  let totalN = 0;

  for (const row of dataRows) {
    const val = String(row[varName] ?? '(missing)');
    freq.set(val, (freq.get(val) ?? 0) + 1);
    totalN++;
  }

  const entries = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const rows: (string | number)[][] = entries.map(([val, count]) => [
    val,
    count,
    parseFloat(formatPercent((count / totalN) * 100)),
    parseFloat(formatPercent((count / totalN) * 100)), // valid % (simplification)
  ]);

  return {
    id: `freq-${varName}-${Date.now()}`,
    type: 'table',
    content: {
      title: `${varName} — Frequency Table`,
      headers: ['Value', 'Frequency', 'Percent', 'Valid %'],
      rows,
      footnotes: [`Total N = ${formatCount(totalN)}`],
    },
    timestamp: new Date(),
    source: 'descriptives',
  };
}

// Statistical helper functions

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

function computeMode(values: number[]): number {
  const freq = new Map<number, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  let mode = values[0]!;
  let maxFreq = 0;
  for (const [val, f] of freq) {
    if (f > maxFreq) { maxFreq = f; mode = val; }
  }
  return mode;
}

function computeSkewness(
  values: number[],
  mean: number,
  stdDev: number,
  n: number,
): number {
  if (stdDev === 0) return 0;
  const m3 = values.reduce((acc, v) => acc + ((v - mean) / stdDev) ** 3, 0) / n;
  return (m3 * n * n) / ((n - 1) * (n - 2));
}

function computeKurtosis(
  values: number[],
  mean: number,
  stdDev: number,
  n: number,
): number {
  if (stdDev === 0) return 0;
  const m4 = values.reduce((acc, v) => acc + ((v - mean) / stdDev) ** 4, 0) / n;
  return (
    ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * m4 * n -
    (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
  );
}
