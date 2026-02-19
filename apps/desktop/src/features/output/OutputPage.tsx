import { BlockOutputViewer as OutputViewer } from '../../components/output/BlockOutputViewer';
import { useOutputStore, type OutputSession } from '../../stores/output-store';

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

export default function OutputPage() {
  const sessions = useOutputStore((state) => state.sessions);
  const selectedSessionId = useOutputStore((state) => state.selectedSessionId);
  const blocks = useOutputStore((state) => state.blocks);
  const isLoading = useOutputStore((state) => state.isLoading);
  const currentAnalysis = useOutputStore((state) => state.currentAnalysis);
  const selectSession = useOutputStore((state) => state.selectSession);
  const deleteSession = useOutputStore((state) => state.deleteSession);
  const clearAllSessions = useOutputStore((state) => state.clearAllSessions);
  const exportToHtml = useOutputStore((state) => state.exportToHtml);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? sessions[sessions.length - 1];

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

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Output</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {isLoading ? `Running ${currentAnalysis}...` : `${sessions.length} analysis results`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {selectedSession && (
            <button
              onClick={handleExport}
              className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
              style={{
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-muted)',
              }}
            >
              Export HTML
            </button>
          )}
          {sessions.length > 0 && (
            <button
              onClick={clearAllSessions}
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
                No analysis results yet
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
                Run an analysis to see results here
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
                Analysis History ({sessions.length})
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

            {/* Output Viewer */}
            <div
              className="flex-1 rounded-lg border overflow-hidden flex flex-col"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border)',
              }}
            >
              {selectedSession && (
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
                          {selectedSession.success ? 'Success' : 'Error'}
                        </span>
                      </div>
                      <div
                        className="text-xs mt-1"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {formatTimestamp(selectedSession.timestamp)} · {selectedSession.blocks.length} blocks
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <OutputViewer blocks={blocks} />
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
