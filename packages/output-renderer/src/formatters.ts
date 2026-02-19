/**
 * Formatting utilities for statistical output.
 * Follows APA 7th edition conventions.
 */

/**
 * Format a generic number to a fixed number of decimal places.
 * Returns "—" for null/undefined/NaN.
 */
export function formatNumber(
  value: number | null | undefined,
  decimals = 3,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '\u2014';
  return value.toFixed(decimals);
}

/**
 * Format a p-value following APA conventions:
 * - p < .001 shown as "< .001"
 * - p >= .001 shown to three decimal places without leading zero, e.g. ".043"
 * - p = 1 shown as "1.000"
 */
export function formatPValue(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return '\u2014';
  if (p < 0.001) return '< .001';
  const formatted = p.toFixed(3);
  // Strip leading zero per APA style
  return formatted.startsWith('0') ? formatted.slice(1) : formatted;
}

/**
 * Format a confidence interval as "[lower, upper]".
 */
export function formatCI(
  lower: number | null | undefined,
  upper: number | null | undefined,
  decimals = 2,
): string {
  return `[${formatNumber(lower, decimals)}, ${formatNumber(upper, decimals)}]`;
}

/**
 * Format a test statistic (t, F, z, etc.) to two decimal places.
 */
export function formatStatistic(value: number | null | undefined): string {
  return formatNumber(value, 2);
}

/**
 * Format degrees of freedom. Handles integer df (e.g. ANOVA) and
 * fractional df (Welch-Satterthwaite).
 */
export function formatDF(df: number | null | undefined): string {
  if (df === null || df === undefined || Number.isNaN(df)) return '\u2014';
  return Number.isInteger(df) ? String(df) : df.toFixed(2);
}

/**
 * Format an effect size (d, eta², etc.) to two decimal places.
 */
export function formatEffectSize(value: number | null | undefined): string {
  return formatNumber(value, 2);
}

/**
 * Format a percentage to one decimal place with the % symbol.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '\u2014';
  return `${value.toFixed(1)}%`;
}

/**
 * Format a count (frequency) as an integer string.
 */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '\u2014';
  return Math.round(value).toLocaleString();
}

/**
 * Format a cell value intelligently: numbers get numeric formatting,
 * strings are returned as-is.
 */
export function formatCell(
  value: string | number | null | undefined,
  decimals = 3,
): string {
  if (value === null || value === undefined) return '\u2014';
  if (typeof value === 'string') return value;
  return formatNumber(value, decimals);
}
