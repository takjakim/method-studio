import React from 'react';
import type { AnalysisResult } from '../../hooks/useAnalysisEngine';

interface AnalysisResultViewerProps {
  result: AnalysisResult | null;
  isLoading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '\u2014';
  if (typeof value === 'number') {
    if (!isFinite(value)) return '\u2014';
    // p-values and small fractions
    if (Math.abs(value) < 0.001 && value !== 0) return value.toExponential(3);
    return value.toFixed(4).replace(/\.?0+$/, '') || '0';
  }
  return String(value);
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Generic key-value statistics table for a single variable or test result.
 * Renders a two-column label/value table styled to match the SPSS-style
 * OutputTable component used elsewhere in the app.
 */
function StatsKeyValueTable({
  title,
  data,
}: {
  title?: string;
  data: Record<string, unknown>;
}) {
  const entries = Object.entries(data).filter(
    ([, v]) => !isPlainObject(v) && !Array.isArray(v),
  );

  if (entries.length === 0) return null;

  return (
    <div className="my-3">
      {title && (
        <p className="text-xs italic text-gray-800 mb-1 font-medium">{title}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-t-2 border-t-gray-700 border-b border-b-gray-400">
              <th className="py-1 px-2 font-semibold text-gray-800 bg-white text-left">
                Statistic
              </th>
              <th className="py-1 px-2 font-semibold text-gray-800 bg-white text-right">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, val], ri) => (
              <tr
                key={key}
                className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}
              >
                <td className="py-0.5 px-2 text-gray-800 font-medium text-left capitalize">
                  {key.replace(/_/g, ' ')}
                </td>
                <td className="py-0.5 px-2 text-gray-800 text-right tabular-nums">
                  {formatValue(val)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-t-gray-600">
              <td colSpan={2} className="pt-0.5" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/**
 * Multi-column table where each row is a variable and each column is a
 * statistic. Used when result.result.stats is an object keyed by variable name.
 */
function StatsMultiVariableTable({
  title,
  stats,
}: {
  title?: string;
  stats: Record<string, Record<string, unknown>>;
}) {
  const variableNames = Object.keys(stats);
  if (variableNames.length === 0) return null;

  // Collect all unique stat column names across variables
  const allKeys = Array.from(
    new Set(
      variableNames.flatMap(v =>
        Object.keys(stats[v] ?? {}).filter(
          k => !isPlainObject(stats[v]?.[k]) && !Array.isArray(stats[v]?.[k]),
        ),
      ),
    ),
  );

  if (allKeys.length === 0) return null;

  return (
    <div className="my-3">
      {title && (
        <p className="text-xs italic text-gray-800 mb-1 font-medium">{title}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-t-2 border-t-gray-700 border-b border-b-gray-400">
              <th className="py-1 px-2 font-semibold text-gray-800 bg-white text-left">
                Variable
              </th>
              {allKeys.map(k => (
                <th
                  key={k}
                  className="py-1 px-2 font-semibold text-gray-800 bg-white text-right capitalize"
                >
                  {k.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {variableNames.map((varName, ri) => (
              <tr
                key={varName}
                className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}
              >
                <td className="py-0.5 px-2 text-gray-800 font-medium text-left">
                  {varName}
                </td>
                {allKeys.map(k => (
                  <td
                    key={k}
                    className="py-0.5 px-2 text-gray-800 text-right tabular-nums"
                  >
                    {formatValue(stats[varName]?.[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-t-gray-600">
              <td colSpan={allKeys.length + 1} className="pt-0.5" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/**
 * Renders a base64-encoded PNG plot image with hover controls.
 */
function PlotImage({
  src,
  index,
}: {
  src: string;
  index: number;
}) {
  const [lightboxOpen, setLightboxOpen] = React.useState(false);

  // Normalise: add data URI prefix if raw base64 was returned
  const dataUri = src.startsWith('data:') ? src : `data:image/png;base64,${src}`;

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = dataUri;
    link.download = `plot-${index + 1}.png`;
    link.click();
  };

  return (
    <div className="my-3">
      <p className="text-xs italic text-gray-800 mb-1 font-medium">
        Plot {index + 1}
      </p>
      <div className="relative inline-block group border border-gray-200 rounded overflow-hidden">
        <img
          src={dataUri}
          alt={`Analysis plot ${index + 1}`}
          className="block max-w-full cursor-zoom-in"
          style={{ maxWidth: 480 }}
          onClick={() => setLightboxOpen(true)}
        />
        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          <button
            onClick={handleDownload}
            className="bg-white/90 border border-gray-300 rounded px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-100 shadow-sm"
            title="Download PNG"
          >
            Download
          </button>
          <button
            onClick={() => setLightboxOpen(true)}
            className="bg-white/90 border border-gray-300 rounded px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-100 shadow-sm"
            title="View full size"
          >
            Expand
          </button>
        </div>
      </div>

      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxOpen(false)}
              className="absolute -top-8 right-0 text-white text-xl font-light hover:text-gray-300"
              aria-label="Close lightbox"
            >
              &times; Close
            </button>
            <img
              src={dataUri}
              alt={`Analysis plot ${index + 1}`}
              className="max-w-full max-h-[85vh] object-contain rounded shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result renderer — handles both descriptives and t-test shapes
// ---------------------------------------------------------------------------

/**
 * Inspects the `result.result` field and renders appropriate statistics tables.
 *
 * Supported shapes:
 *
 * Descriptives:
 *   { stats: { varName: { mean, std, min, max, ... }, ... } }
 *   — or —
 *   { varName: { mean, std, ... }, ... }  (flat object of objects)
 *
 * T-test:
 *   { statistic, df, p_value, effect_size, descriptives: { ... }, ... }
 */
function ResultContent({ analysisResult }: { analysisResult: AnalysisResult }) {
  const raw = analysisResult.result;

  // Render nothing meaningful if result data is missing
  if (raw === undefined || raw === null) {
    return null;
  }

  const sections: React.ReactNode[] = [];

  if (isPlainObject(raw)) {
    // -----------------------------------------------------------------------
    // Shape: { stats: { varName: { ... }, ... } }  — descriptives
    // -----------------------------------------------------------------------
    if (isPlainObject(raw['stats'])) {
      const stats = raw['stats'] as Record<string, unknown>;
      // Check if values are themselves objects (per-variable breakdown)
      const allValuesAreObjects = Object.values(stats).every(isPlainObject);
      if (allValuesAreObjects) {
        sections.push(
          <StatsMultiVariableTable
            key="stats-multi"
            title="Descriptive Statistics"
            stats={stats as Record<string, Record<string, unknown>>}
          />,
        );
      } else {
        sections.push(
          <StatsKeyValueTable
            key="stats-kv"
            title="Descriptive Statistics"
            data={stats}
          />,
        );
      }
    }

    // -----------------------------------------------------------------------
    // Shape: t-test top-level scalars (statistic, df, p_value, ...)
    // -----------------------------------------------------------------------
    const ttestKeys = ['statistic', 't', 't_statistic', 'df', 'p_value', 'p', 'effect_size'];
    const hasTTestShape = ttestKeys.some(k => k in raw);

    if (hasTTestShape) {
      // Scalar stats for the test itself
      const scalarEntries = Object.entries(raw).filter(
        ([, v]) => !isPlainObject(v) && !Array.isArray(v),
      );
      if (scalarEntries.length > 0) {
        sections.push(
          <StatsKeyValueTable
            key="ttest-scalars"
            title="Test Statistics"
            data={Object.fromEntries(scalarEntries)}
          />,
        );
      }

      // Descriptives sub-object
      if (isPlainObject(raw['descriptives'])) {
        const desc = raw['descriptives'] as Record<string, unknown>;
        const allDescValuesAreObjects = Object.values(desc).every(isPlainObject);
        if (allDescValuesAreObjects) {
          sections.push(
            <StatsMultiVariableTable
              key="ttest-desc-multi"
              title="Group Descriptives"
              stats={desc as Record<string, Record<string, unknown>>}
            />,
          );
        } else {
          sections.push(
            <StatsKeyValueTable
              key="ttest-desc-kv"
              title="Descriptives"
              data={desc}
            />,
          );
        }
      }

      // Confidence interval sub-object
      if (isPlainObject(raw['confidence_interval']) || isPlainObject(raw['ci'])) {
        const ci = (raw['confidence_interval'] ?? raw['ci']) as Record<string, unknown>;
        sections.push(
          <StatsKeyValueTable
            key="ttest-ci"
            title="Confidence Interval"
            data={ci}
          />,
        );
      }
    }

    // -----------------------------------------------------------------------
    // Shape: flat object of objects — per-variable descriptives without
    // a "stats" wrapper key. Only if nothing matched above.
    // -----------------------------------------------------------------------
    if (sections.length === 0) {
      const topValues = Object.values(raw);
      const allTopValuesAreObjects = topValues.length > 0 && topValues.every(isPlainObject);

      if (allTopValuesAreObjects) {
        sections.push(
          <StatsMultiVariableTable
            key="flat-multi"
            title="Statistics"
            stats={raw as Record<string, Record<string, unknown>>}
          />,
        );
      } else {
        // Catch-all: render as key-value
        sections.push(
          <StatsKeyValueTable
            key="fallback-kv"
            title="Results"
            data={raw}
          />,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Plots
  // -------------------------------------------------------------------------
  if (analysisResult.plots && analysisResult.plots.length > 0) {
    sections.push(
      <div key="plots-section">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-5 mb-2">
          Plots
        </p>
        {analysisResult.plots.map((src, i) => (
          <PlotImage key={i} src={src} index={i} />
        ))}
      </div>,
    );
  }

  // -------------------------------------------------------------------------
  // Raw output text
  // -------------------------------------------------------------------------
  if (analysisResult.output && analysisResult.output.trim().length > 0) {
    sections.push(
      <div key="raw-output" className="mt-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Console Output
        </p>
        <pre className="text-[11px] bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto text-gray-700 leading-relaxed whitespace-pre-wrap break-words font-mono">
          {analysisResult.output}
        </pre>
      </div>,
    );
  }

  return <>{sections}</>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * OutputViewer displays the result of a statistical analysis run through the
 * Tauri-backed analysis engine. It handles three display states:
 *
 * 1. Loading — spinning indicator
 * 2. Error — red callout with message
 * 3. Result — statistics tables, plots, and raw console output
 *
 * The component is intentionally self-contained: it accepts the raw
 * `AnalysisResult` shape from `useAnalysisEngine` and introspects the
 * `result.result` field to render appropriate table layouts for both
 * descriptive statistics and t-test results.
 */
export function AnalysisResultViewer({ result, isLoading, error }: AnalysisResultViewerProps) {
  // ------ Loading state ------
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[120px] gap-3 text-gray-500 select-none">
        <svg
          className="w-6 h-6 animate-spin text-blue-500"
          fill="none"
          viewBox="0 0 24 24"
          aria-label="Loading"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
        <p className="text-xs">Running analysis…</p>
      </div>
    );
  }

  // ------ Error state ------
  if (error) {
    return (
      <div className="m-4">
        <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border-l-4 border-red-500 rounded-r">
          <span className="text-red-600 font-bold text-xs mt-0.5 flex-shrink-0">
            Error
          </span>
          <p className="text-xs text-red-800 break-words">{error}</p>
        </div>
      </div>
    );
  }

  // ------ Empty state ------
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[120px] text-gray-400 select-none">
        <svg
          className="w-10 h-10 mb-2 opacity-30"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 17v-6h6v6M3 21h18M3 10l9-7 9 7"
          />
        </svg>
        <p className="text-xs">Run an analysis to see output here.</p>
      </div>
    );
  }

  // ------ Failed result (engine returned success: false) ------
  if (!result.success) {
    const msg = result.error ?? 'The analysis did not complete successfully.';
    return (
      <div className="m-4">
        <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border-l-4 border-red-500 rounded-r">
          <span className="text-red-600 font-bold text-xs mt-0.5 flex-shrink-0">
            Error
          </span>
          <p className="text-xs text-red-800 break-words">{msg}</p>
        </div>
        {/* Still render output text if present (e.g. R error traces) */}
        {result.output && result.output.trim().length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Console Output
            </p>
            <pre className="text-[11px] bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto text-gray-700 leading-relaxed whitespace-pre-wrap break-words font-mono">
              {result.output}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // ------ Successful result ------
  return (
    <div className="px-6 py-4 bg-white font-serif text-sm overflow-y-auto">
      <ResultContent analysisResult={result} />
    </div>
  );
}
