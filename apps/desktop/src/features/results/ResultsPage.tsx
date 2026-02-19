import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BlockOutputViewer as OutputViewer } from '../../components/output/BlockOutputViewer';
import { useOutputStore, type OutputSession } from '../../stores/output-store';
import { useSyntaxStore } from '../../stores/syntax-store';
import { useDataStore } from '../../stores/data-store';

type ViewTab = 'output' | 'script';

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
    'cfa': 'Confirmatory Factor Analysis',
    'regression': 'Regression',
    'regression-linear': 'Linear Regression',
    'mediation': 'Mediation (Model 4)',
    'moderation': 'Moderation (Model 1)',
    'moderated-mediation': 'Moderated Mediation (Model 7)',
    'serial-mediation': 'Serial Mediation',
    'path-analysis': 'Path Analysis',
    'multigroup-cfa': 'Multigroup CFA',
    'full-sem': 'Full SEM',
    'multilevel': 'Multilevel/HLM',
    'process-model-8': 'PROCESS Model 8',
    'process-model-58': 'PROCESS Model 58',
    'process-model-59': 'PROCESS Model 59',
  };
  return labels[specId] ?? specId;
}

export default function ResultsPage() {
  const { t } = useTranslation();
  const [viewTab, setViewTab] = useState<ViewTab>('output');
  const [scriptViewMode, setScriptViewMode] = useState<'summary' | 'full'>('summary');
  const [copied, setCopied] = useState(false);
  const [showLabels, setShowLabels] = useState(() => {
    const saved = localStorage.getItem('method-studio-show-labels');
    return saved === 'true';
  });

  // Save showLabels preference
  useEffect(() => {
    localStorage.setItem('method-studio-show-labels', String(showLabels));
  }, [showLabels]);

  // Output store
  const sessions = useOutputStore((state) => state.sessions);
  const selectedSessionId = useOutputStore((state) => state.selectedSessionId);
  const blocks = useOutputStore((state) => state.blocks);
  const isLoading = useOutputStore((state) => state.isLoading);
  const selectSession = useOutputStore((state) => state.selectSession);
  const deleteSession = useOutputStore((state) => state.deleteSession);
  const clearAllSessions = useOutputStore((state) => state.clearAllSessions);
  const exportToHtml = useOutputStore((state) => state.exportToHtml);

  // Syntax store
  const scripts = useSyntaxStore((state) => state.scripts);
  const clearScripts = useSyntaxStore((state) => state.clearScripts);

  // Data store - for variable labels
  const dataset = useDataStore((state) => state.dataset);
  const variableLabels: Record<string, string> = {};
  if (dataset) {
    dataset.variables.forEach((v) => {
      if (v.label) {
        variableLabels[v.name] = v.label;
      }
    });
  }

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? sessions[sessions.length - 1];

  // Find matching script for the selected session
  const matchingScript = selectedSession
    ? scripts.find((s) => s.specId === selectedSession.specId &&
        Math.abs(s.timestamp.getTime() - selectedSession.timestamp.getTime()) < 5000)
    : scripts[scripts.length - 1];

  const displayScript = matchingScript
    ? scriptViewMode === 'summary' && matchingScript.scriptSummary
      ? matchingScript.scriptSummary
      : matchingScript.script
    : '';

  const handleExport = () => {
    const html = exportToHtml(selectedSession?.id);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `method-studio-output-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearAll = () => {
    clearAllSessions();
    clearScripts();
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>{t('results.title')}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {isLoading ? t('results.loading') : `${sessions.length} analysis results`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Show Labels Toggle */}
          <label
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded border cursor-pointer hover:bg-gray-50"
            style={{
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-muted)',
            }}
          >
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              className="w-3 h-3"
            />
            {t('results.showLabels')}
          </label>
          {selectedSession && (
            <button
              onClick={handleExport}
              className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
              style={{
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-muted)',
              }}
            >
              {t('results.exportHtml')}
            </button>
          )}
          {sessions.length > 0 && (
            <button
              onClick={handleClearAll}
              className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
              style={{
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-muted)',
              }}
            >
              {t('results.clearAll')}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {sessions.length === 0 ? (
          <div
            className="flex-1 rounded-lg border flex items-center justify-center"
            style={{
              backgroundColor: 'var(--color-bg-secondary)',
              borderColor: 'var(--color-border)',
            }}
          >
            <div className="text-center">
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {t('results.noResults')}
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
                {t('results.runAnalysisHint')}
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Session List */}
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
                {t('results.analysisHistory')} ({sessions.length})
              </div>
              <div className="flex-1 overflow-y-auto">
                {[...sessions].reverse().map((session) => (
                  <SessionListItem
                    key={session.id}
                    session={session}
                    isSelected={session.id === selectedSession?.id}
                    onSelect={() => selectSession(session.id)}
                    onDelete={() => deleteSession(session.id)}
                  />
                ))}
              </div>
            </div>

            {/* Main Content Area */}
            <div
              className="flex-1 rounded-lg border overflow-hidden flex flex-col"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border)',
              }}
            >
              {selectedSession && (
                <>
                  {/* Header with session info and tabs */}
                  <div
                    className="px-4 py-3 border-b"
                    style={{
                      borderColor: 'var(--color-border)',
                      backgroundColor: 'var(--color-bg)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="text-sm font-medium"
                            style={{ color: 'var(--color-text)' }}
                          >
                            {getSpecLabel(selectedSession.specId)}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-xs rounded font-medium ${
                              selectedSession.engine === 'r'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}
                          >
                            {selectedSession.engine === 'r' ? 'R' : 'Python'}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-xs rounded ${
                              selectedSession.success
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {selectedSession.success ? t('results.success') : t('results.error')}
                          </span>
                        </div>
                        <div
                          className="text-xs mt-1"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {formatTimestamp(selectedSession.timestamp)} · {selectedSession.blocks.length} blocks
                        </div>
                      </div>

                      {/* View Tabs */}
                      <div className="flex items-center gap-3">
                        <div className="flex rounded border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                          <button
                            onClick={() => setViewTab('output')}
                            className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                              viewTab === 'output'
                                ? 'bg-blue-500 text-white'
                                : 'bg-white hover:bg-gray-100'
                            }`}
                            style={viewTab !== 'output' ? { color: 'var(--color-text-muted)' } : {}}
                          >
                            {t('results.output')}
                          </button>
                          <button
                            onClick={() => setViewTab('script')}
                            className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                              viewTab === 'script'
                                ? 'bg-blue-500 text-white'
                                : 'bg-white hover:bg-gray-100'
                            }`}
                            style={viewTab !== 'script' ? { color: 'var(--color-text-muted)' } : {}}
                          >
                            {t('results.syntax')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Content based on selected tab */}
                  <div className="flex-1 overflow-auto">
                    {viewTab === 'output' ? (
                      <OutputViewer
                        blocks={blocks}
                        showLabels={showLabels}
                        variableLabels={variableLabels}
                      />
                    ) : (
                      <div className="flex flex-col h-full">
                        {/* Syntax toolbar */}
                        {matchingScript && (
                          <div
                            className="flex items-center justify-between px-4 py-2 border-b"
                            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}
                          >
                            {/* Summary/Full toggle */}
                            {matchingScript.scriptSummary ? (
                              <div className="flex rounded border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                                <button
                                  onClick={() => setScriptViewMode('summary')}
                                  className={`px-3 py-1 text-xs transition-colors ${
                                    scriptViewMode === 'summary'
                                      ? 'bg-blue-500 text-white'
                                      : 'bg-white hover:bg-gray-100'
                                  }`}
                                  style={scriptViewMode !== 'summary' ? { color: 'var(--color-text-muted)' } : {}}
                                >
                                  {t('results.scriptSummary')}
                                </button>
                                <button
                                  onClick={() => setScriptViewMode('full')}
                                  className={`px-3 py-1 text-xs transition-colors ${
                                    scriptViewMode === 'full'
                                      ? 'bg-blue-500 text-white'
                                      : 'bg-white hover:bg-gray-100'
                                  }`}
                                  style={scriptViewMode !== 'full' ? { color: 'var(--color-text-muted)' } : {}}
                                >
                                  {t('results.scriptFull')}
                                </button>
                              </div>
                            ) : (
                              <div />
                            )}

                            {/* Copy button */}
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(displayScript);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              }}
                              className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
                              style={{
                                borderColor: 'var(--color-border)',
                                color: 'var(--color-text-muted)',
                              }}
                            >
                              {copied ? t('results.copied') : t('results.copySyntax')}
                            </button>
                          </div>
                        )}

                        {/* Script content */}
                        <div className="flex-1 overflow-auto p-4">
                          {matchingScript ? (
                            <pre
                              className="text-xs font-mono whitespace-pre-wrap"
                              style={{
                                color: 'var(--color-text)',
                                lineHeight: 1.6,
                              }}
                            >
                              {displayScript}
                            </pre>
                          ) : (
                            <div className="text-center py-8">
                              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                {t('results.noScript')}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
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

function SessionListItem({
  session,
  isSelected,
  onSelect,
  onDelete,
}: {
  session: OutputSession;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`relative group w-full border-b transition-colors ${
        isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
      style={{
        borderColor: 'var(--color-border)',
      }}
    >
      <button
        onClick={onSelect}
        className="w-full px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              session.success ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span
            className="text-xs font-medium truncate"
            style={{ color: isSelected ? '#2563eb' : 'var(--color-text)' }}
          >
            {getSpecLabel(session.specId)}
          </span>
          <span
            className={`ml-auto text-[10px] px-1.5 rounded ${
              session.engine === 'r'
                ? 'bg-blue-100 text-blue-600'
                : 'bg-yellow-100 text-yellow-600'
            }`}
          >
            {session.engine === 'r' ? 'R' : 'Py'}
          </span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span
            className="text-[10px] truncate"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {formatTimestamp(session.timestamp)}
          </span>
          <span
            className="text-[10px]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {session.blocks.length} blocks
          </span>
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
      >
        ×
      </button>
    </div>
  );
}
