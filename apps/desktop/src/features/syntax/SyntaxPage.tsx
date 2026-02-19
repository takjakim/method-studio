import { useState } from 'react';
import { useSyntaxStore, type ScriptEntry } from '../../stores/syntax-store';

function formatTimestamp(date: Date): string {
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getSpecLabel(specId: string): string {
  const labels: Record<string, string> = {
    'ttest-one-sample': 'One-Sample T-Test',
    'ttest-independent': 'Independent-Samples T-Test',
    'ttest-paired': 'Paired-Samples T-Test',
    'descriptives': 'Descriptives',
    'anova': 'ANOVA',
    'anova-oneway': 'One-Way ANOVA',
    'correlation': 'Correlation',
    'efa': 'Exploratory Factor Analysis',
    'regression': 'Regression',
    'regression-linear': 'Linear Regression',
  };
  return labels[specId] ?? specId;
}

export default function SyntaxPage() {
  const scripts = useSyntaxStore((state) => state.scripts);
  const selectedScriptId = useSyntaxStore((state) => state.selectedScriptId);
  const selectScript = useSyntaxStore((state) => state.selectScript);
  const clearScripts = useSyntaxStore((state) => state.clearScripts);

  const [viewMode, setViewMode] = useState<'summary' | 'full'>('summary');

  const selectedScript = scripts.find((s) => s.id === selectedScriptId) ?? scripts[scripts.length - 1];

  const displayScript = selectedScript
    ? viewMode === 'summary' && selectedScript.scriptSummary
      ? selectedScript.scriptSummary
      : selectedScript.script
    : '';

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Syntax</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            View executed R / Python scripts
          </p>
        </div>
        {scripts.length > 0 && (
          <button
            onClick={clearScripts}
            className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
            style={{
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-muted)',
            }}
          >
            Clear All
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {scripts.length === 0 ? (
          <div
            className="flex-1 rounded-lg border flex items-center justify-center"
            style={{
              backgroundColor: 'var(--color-bg-secondary)',
              borderColor: 'var(--color-border)',
            }}
          >
            <div className="text-center">
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                No scripts executed yet
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
                Run an analysis to see the executed script here
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Script List */}
            <div
              className="w-64 rounded-lg border overflow-hidden flex flex-col"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border)',
              }}
            >
              <div
                className="px-3 py-2 text-xs font-medium border-b"
                style={{
                  color: 'var(--color-text-muted)',
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-bg)',
                }}
              >
                Script History ({scripts.length})
              </div>
              <div className="flex-1 overflow-y-auto">
                {[...scripts].reverse().map((script) => (
                  <ScriptListItem
                    key={script.id}
                    script={script}
                    isSelected={script.id === selectedScript?.id}
                    onSelect={() => selectScript(script.id)}
                  />
                ))}
              </div>
            </div>

            {/* Script Viewer */}
            <div
              className="flex-1 rounded-lg border overflow-hidden flex flex-col"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border)',
              }}
            >
              {selectedScript && (
                <>
                  <div
                    className="px-4 py-3 border-b flex items-center justify-between"
                    style={{
                      borderColor: 'var(--color-border)',
                      backgroundColor: 'var(--color-bg)',
                    }}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className="text-sm font-medium"
                          style={{ color: 'var(--color-text)' }}
                        >
                          {getSpecLabel(selectedScript.specId)}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs rounded font-medium ${
                            selectedScript.engine === 'r'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {selectedScript.engine === 'r' ? 'R' : 'Python'}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs rounded ${
                            selectedScript.success
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {selectedScript.success ? 'Success' : 'Error'}
                        </span>
                      </div>
                      <div
                        className="text-xs mt-1"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {formatTimestamp(selectedScript.timestamp)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* View Mode Toggle */}
                      {selectedScript.scriptSummary && (
                        <div className="flex rounded border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                          <button
                            onClick={() => setViewMode('summary')}
                            className={`px-3 py-1 text-xs transition-colors ${
                              viewMode === 'summary'
                                ? 'bg-blue-500 text-white'
                                : 'bg-white hover:bg-gray-100'
                            }`}
                            style={viewMode !== 'summary' ? { color: 'var(--color-text-muted)' } : {}}
                          >
                            Summary
                          </button>
                          <button
                            onClick={() => setViewMode('full')}
                            className={`px-3 py-1 text-xs transition-colors ${
                              viewMode === 'full'
                                ? 'bg-blue-500 text-white'
                                : 'bg-white hover:bg-gray-100'
                            }`}
                            style={viewMode !== 'full' ? { color: 'var(--color-text-muted)' } : {}}
                          >
                            Full
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => navigator.clipboard.writeText(displayScript)}
                        className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
                        style={{
                          borderColor: 'var(--color-border)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto p-4">
                    <pre
                      className="text-xs font-mono whitespace-pre-wrap"
                      style={{
                        color: 'var(--color-text)',
                        lineHeight: 1.6,
                      }}
                    >
                      {displayScript}
                    </pre>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ScriptListItem({
  script,
  isSelected,
  onSelect,
}: {
  script: ScriptEntry;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full px-3 py-2 text-left border-b transition-colors ${
        isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
      style={{
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            script.success ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span
          className="text-xs font-medium truncate"
          style={{ color: isSelected ? '#2563eb' : 'var(--color-text)' }}
        >
          {getSpecLabel(script.specId)}
        </span>
        <span
          className={`ml-auto text-[10px] px-1.5 rounded ${
            script.engine === 'r'
              ? 'bg-blue-100 text-blue-600'
              : 'bg-yellow-100 text-yellow-600'
          }`}
        >
          {script.engine === 'r' ? 'R' : 'Py'}
        </span>
      </div>
      <div
        className="text-[10px] mt-1 truncate"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {formatTimestamp(script.timestamp)}
      </div>
    </button>
  );
}
