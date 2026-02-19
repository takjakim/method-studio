import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDataStore } from '../stores/data-store';
import { useSyntaxStore } from '../stores/syntax-store';
import { useOutputStore } from '../stores/output-store';
import { useNavigationStore } from '../stores/navigation-store';
import type { ProcessDiagramOutput } from '../stores/output-store';
import type { AnalysisRequest, SlotAssignment } from '@method-studio/analysis-specs';

// Re-export for backwards compatibility
export type { AnalysisRequest };

export interface AnalysisResult {
  success: boolean;
  result?: unknown;
  error?: string;
  output?: string;
  plots?: string[];
  script?: string;
  script_summary?: string;
}

interface InvokeAnalysisRequest {
  specId: string;
  variables: SlotAssignment;
  options: Record<string, unknown>;
  engine: 'r' | 'python';
  datasetName: string;
  data: Record<string, unknown>[];
}

// Helper functions for processing results
function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '\u2014';
  if (typeof value === 'number') {
    if (!isFinite(value)) return '\u2014';
    if (Math.abs(value) < 0.001 && value !== 0) return value.toExponential(3);
    return value.toFixed(4).replace(/\.?0+$/, '') || '0';
  }
  return String(value);
}

function getSpecLabel(specId: string): string {
  const labels: Record<string, string> = {
    'ttest-one-sample': 'One-Sample T-Test',
    'ttest-independent': 'Independent-Samples T-Test',
    'ttest-paired': 'Paired-Samples T-Test',
    'descriptives': 'Descriptive Statistics',
    'anova': 'ANOVA',
    'anova-oneway': 'One-Way ANOVA',
    'correlation': 'Correlation Analysis',
    'efa': 'Exploratory Factor Analysis',
    'regression': 'Regression Analysis',
    'regression-linear': 'Linear Regression',
  };
  return labels[specId] ?? specId;
}

export function useAnalysisEngine() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const dataset = useDataStore((state) => state.dataset);
  const addScript = useSyntaxStore((state) => state.addScript);

  // Output store actions
  const startSession = useOutputStore((state) => state.startSession);
  const endSession = useOutputStore((state) => state.endSession);
  const addTitle = useOutputStore((state) => state.addTitle);
  const addTable = useOutputStore((state) => state.addTable);
  const addText = useOutputStore((state) => state.addText);
  const addPlot = useOutputStore((state) => state.addPlot);
  const addProcessDiagram = useOutputStore((state) => state.addProcessDiagram);
  const addError = useOutputStore((state) => state.addError);
  const setLoading = useOutputStore((state) => state.setLoading);

  // Convert analysis result to output blocks
  const populateOutputBlocks = useCallback((
    analysisResult: AnalysisResult,
    specId: string
  ) => {
    const raw = analysisResult.result;

    // Add title
    addTitle(getSpecLabel(specId), specId);

    if (!analysisResult.success) {
      addError(analysisResult.error ?? 'Analysis failed');
      if (analysisResult.output && analysisResult.output.trim()) {
        addText(analysisResult.output, specId);
      }
      return;
    }

    if (raw && isPlainObject(raw)) {
      // Handle stats object (descriptives)
      if (isPlainObject(raw['stats'])) {
        const stats = raw['stats'] as Record<string, unknown>;
        const allValuesAreObjects = Object.values(stats).every(isPlainObject);

        if (allValuesAreObjects) {
          // Multi-variable table
          const variableNames = Object.keys(stats);
          const allKeys = Array.from(
            new Set(
              variableNames.flatMap(v =>
                Object.keys((stats[v] as Record<string, unknown>) ?? {}).filter(
                  k => !isPlainObject((stats[v] as Record<string, unknown>)?.[k]) &&
                       !Array.isArray((stats[v] as Record<string, unknown>)?.[k]),
                ),
              ),
            ),
          );

          if (allKeys.length > 0) {
            addTable({
              title: 'Descriptive Statistics',
              headers: ['Variable', ...allKeys.map(k => k.replace(/_/g, ' '))],
              rows: variableNames.map(varName => [
                varName,
                ...allKeys.map(k => formatValue((stats[varName] as Record<string, unknown>)?.[k])),
              ]),
            }, specId);
          }
        } else {
          // Key-value table
          const entries = Object.entries(stats).filter(
            ([, v]) => !isPlainObject(v) && !Array.isArray(v),
          );
          if (entries.length > 0) {
            addTable({
              title: 'Descriptive Statistics',
              headers: ['Statistic', 'Value'],
              rows: entries.map(([k, v]) => [k.replace(/_/g, ' '), formatValue(v)]),
            }, specId);
          }
        }
      }

      // Handle t-test results
      const ttestKeys = ['statistic', 't', 't_statistic', 'df', 'p_value', 'p', 'effect_size', 'cohens_d'];
      const hasTTestShape = ttestKeys.some(k => k in raw);

      if (hasTTestShape) {
        // Main test statistics
        const scalarEntries = Object.entries(raw).filter(
          ([k, v]) => !isPlainObject(v) && !Array.isArray(v) && k !== 'interpretation',
        );
        if (scalarEntries.length > 0) {
          addTable({
            title: 'Test Statistics',
            headers: ['Statistic', 'Value'],
            rows: scalarEntries.map(([k, v]) => [k.replace(/_/g, ' '), formatValue(v)]),
          }, specId);
        }

        // Means/SDs if present
        if (isPlainObject(raw['means'])) {
          const means = raw['means'] as Record<string, unknown>;
          const sds = (raw['sds'] ?? {}) as Record<string, unknown>;
          const ns = (raw['ns'] ?? {}) as Record<string, unknown>;

          const groups = Object.keys(means);
          addTable({
            title: 'Group Statistics',
            headers: ['Group', 'Mean', 'SD', 'N'],
            rows: groups.map(g => [
              g,
              formatValue(means[g]),
              formatValue(sds[g]),
              formatValue(ns[g]),
            ]),
          }, specId);
        }

        // Interpretation
        if (typeof raw['interpretation'] === 'string') {
          addText(raw['interpretation'], specId);
        }
      }

      // Handle ANOVA, Correlation, EFA, Regression results
      if (!hasTTestShape && !isPlainObject(raw['stats'])) {
        const topValues = Object.values(raw);
        const allTopValuesAreObjects = topValues.length > 0 && topValues.every(isPlainObject);

        if (allTopValuesAreObjects) {
          // Multi-variable table
          const variableNames = Object.keys(raw);
          const allKeys = Array.from(
            new Set(
              variableNames.flatMap(v =>
                Object.keys((raw[v] as Record<string, unknown>) ?? {}).filter(
                  k => !isPlainObject((raw[v] as Record<string, unknown>)?.[k]) &&
                       !Array.isArray((raw[v] as Record<string, unknown>)?.[k]),
                ),
              ),
            ),
          );

          if (allKeys.length > 0) {
            addTable({
              title: 'Results',
              headers: ['', ...allKeys.map(k => k.replace(/_/g, ' '))],
              rows: variableNames.map(varName => [
                varName,
                ...allKeys.map(k => formatValue((raw[varName] as Record<string, unknown>)?.[k])),
              ]),
            }, specId);
          }
        } else {
          // Key-value table for simple results
          const entries = Object.entries(raw).filter(
            ([k, v]) => !isPlainObject(v) && !Array.isArray(v) && k !== 'interpretation',
          );
          if (entries.length > 0) {
            addTable({
              title: 'Results',
              headers: ['Statistic', 'Value'],
              rows: entries.map(([k, v]) => [k.replace(/_/g, ' '), formatValue(v)]),
            }, specId);
          }

          // Interpretation
          if (typeof raw['interpretation'] === 'string') {
            addText(raw['interpretation'], specId);
          }
        }
      }
    }

    // Add plots
    if (analysisResult.plots && analysisResult.plots.length > 0) {
      for (const plot of analysisResult.plots) {
        const dataUri = plot.startsWith('data:') ? plot : `data:image/png;base64,${plot}`;
        addPlot({ imageDataUri: dataUri, altText: 'Analysis Plot' }, specId);
      }
    }

    // Add PROCESS diagram for mediation/moderation analyses
    if (raw && isPlainObject(raw) && isPlainObject(raw['diagram'])) {
      const diagram = raw['diagram'] as Record<string, unknown>;
      const modelType = diagram['modelType'] as ProcessDiagramOutput['modelType'];

      if (modelType && ['mediation', 'moderation', 'moderated-mediation', 'serial-mediation'].includes(modelType)) {
        const diagramData: ProcessDiagramOutput = {
          modelType,
          variables: (diagram['variables'] ?? {}) as ProcessDiagramOutput['variables'],
          coefficients: (diagram['coefficients'] ?? {}) as ProcessDiagramOutput['coefficients'],
          pValues: (diagram['pValues'] ?? {}) as ProcessDiagramOutput['pValues'],
          confidence: (diagram['confidence'] ?? undefined) as ProcessDiagramOutput['confidence'],
        };
        addProcessDiagram(diagramData, specId);
      }
    }

    // Add raw output
    if (analysisResult.output && analysisResult.output.trim()) {
      addText(`Console Output:\n${analysisResult.output}`, specId);
    }
  }, [addTitle, addTable, addText, addPlot, addProcessDiagram, addError]);

  // Navigation store for auto-navigation to results
  const navigateTo = useNavigationStore((state) => state.navigateTo);

  const runAnalysis = useCallback(
    async (request: AnalysisRequest): Promise<AnalysisResult> => {
      setIsLoading(true);
      setError(null);
      setLoading(true, getSpecLabel(request.specId));

      // Start output session
      startSession(request.specId, request.engine);

      try {
        const data = dataset?.data ?? [];

        const invokeRequest: InvokeAnalysisRequest = {
          specId: request.specId,
          variables: request.variables,
          options: request.options,
          engine: request.engine,
          datasetName: request.datasetName,
          data,
        };

        const analysisResult = await invoke<AnalysisResult>('run_analysis', {
          request: invokeRequest,
        });

        setResult(analysisResult);

        // Save script to syntax store
        if (analysisResult.script) {
          addScript({
            specId: request.specId,
            engine: request.engine,
            script: analysisResult.script,
            scriptSummary: analysisResult.script_summary,
            success: analysisResult.success,
          });
        }

        // Populate output blocks
        populateOutputBlocks(analysisResult, request.specId);

        // End output session
        endSession(analysisResult.success);

        // Auto-navigate to results page
        navigateTo('/results');

        if (!analysisResult.success && analysisResult.error) {
          setError(analysisResult.error);
        }

        return analysisResult;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        const failedResult: AnalysisResult = {
          success: false,
          error: errorMessage,
        };
        setError(errorMessage);
        setResult(failedResult);

        // Add error to output
        addError(errorMessage);
        endSession(false);

        // Navigate to results even on error to show the error
        navigateTo('/results');

        return failedResult;
      } finally {
        setIsLoading(false);
        setLoading(false);
      }
    },
    [dataset, addScript, startSession, endSession, populateOutputBlocks, addError, setLoading, navigateTo]
  );

  const clearResult = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    runAnalysis,
    isLoading,
    error,
    result,
    clearResult,
  };
}
