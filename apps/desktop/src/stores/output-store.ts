import { create } from 'zustand';
import type { TypedOutputBlock, TableOutput, PlotOutput, ProcessDiagramOutput } from '@method-studio/output-renderer';

export interface OutputSession {
  id: string;
  timestamp: Date;
  specId: string;
  engine: 'r' | 'python';
  success: boolean;
  blocks: TypedOutputBlock[];
}

interface OutputState {
  sessions: OutputSession[];
  selectedSessionId: string | null;
  // Current session being built
  currentSessionId: string | null;
  isLoading: boolean;
  currentAnalysis: string | null;
}

interface OutputActions {
  // Session management
  startSession: (specId: string, engine: 'r' | 'python') => string;
  endSession: (success: boolean) => void;
  selectSession: (id: string | null) => void;
  deleteSession: (id: string) => void;
  clearAllSessions: () => void;
  getSelectedSession: () => OutputSession | null;

  // Block management (adds to current session)
  addBlock: (block: Omit<TypedOutputBlock, 'id' | 'timestamp'>) => void;
  addTitle: (text: string, source?: string) => void;
  addSubtitle: (text: string, source?: string) => void;
  addTable: (table: TableOutput, source?: string) => void;
  addText: (text: string, source?: string) => void;
  addPlot: (plot: PlotOutput, source?: string) => void;
  addProcessDiagram: (diagram: ProcessDiagramOutput, source?: string) => void;
  addWarning: (text: string) => void;
  addError: (text: string) => void;

  // Legacy compatibility
  clearOutput: () => void;
  setLoading: (loading: boolean, analysis?: string) => void;
  exportToHtml: (sessionId?: string) => string;

  // Computed - all blocks from selected session
  blocks: TypedOutputBlock[];
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useOutputStore = create<OutputState & OutputActions>((set, get) => ({
  sessions: [],
  selectedSessionId: null,
  currentSessionId: null,
  isLoading: false,
  currentAnalysis: null,
  blocks: [],

  startSession: (specId, engine) => {
    const id = generateId();
    const newSession: OutputSession = {
      id,
      timestamp: new Date(),
      specId,
      engine,
      success: false,
      blocks: [],
    };
    set((state) => ({
      sessions: [...state.sessions, newSession],
      currentSessionId: id,
      selectedSessionId: id,
    }));
    return id;
  },

  endSession: (success) => {
    const { currentSessionId } = get();
    if (!currentSessionId) return;

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === currentSessionId ? { ...s, success } : s
      ),
      currentSessionId: null,
      blocks: state.sessions.find((s) => s.id === currentSessionId)?.blocks ?? [],
    }));
  },

  selectSession: (id) => {
    set((state) => {
      const session = id ? state.sessions.find((s) => s.id === id) : null;
      return {
        selectedSessionId: id,
        blocks: session?.blocks ?? [],
      };
    });
  },

  deleteSession: (id) => {
    set((state) => {
      const newSessions = state.sessions.filter((s) => s.id !== id);
      const wasSelected = state.selectedSessionId === id;
      const lastSession = newSessions[newSessions.length - 1];
      return {
        sessions: newSessions,
        selectedSessionId: wasSelected ? (lastSession?.id ?? null) : state.selectedSessionId,
        blocks: wasSelected ? (lastSession?.blocks ?? []) : state.blocks,
      };
    });
  },

  clearAllSessions: () => {
    set({ sessions: [], selectedSessionId: null, currentSessionId: null, blocks: [] });
  },

  getSelectedSession: () => {
    const { sessions, selectedSessionId } = get();
    if (!selectedSessionId) return sessions[sessions.length - 1] ?? null;
    return sessions.find((s) => s.id === selectedSessionId) ?? null;
  },

  addBlock: (block) => {
    const { currentSessionId, selectedSessionId } = get();
    const targetSessionId = currentSessionId ?? selectedSessionId;
    if (!targetSessionId) return;

    const newBlock = {
      ...block,
      id: generateId(),
      timestamp: new Date(),
    } as TypedOutputBlock;

    set((state) => {
      const updatedSessions = state.sessions.map((s) =>
        s.id === targetSessionId
          ? { ...s, blocks: [...s.blocks, newBlock] }
          : s
      );
      const targetSession = updatedSessions.find((s) => s.id === targetSessionId);
      return {
        sessions: updatedSessions,
        blocks: state.selectedSessionId === targetSessionId ? (targetSession?.blocks ?? []) : state.blocks,
      };
    });
  },

  addTitle: (text, source) => {
    get().addBlock({ type: 'title', content: text, source } as Omit<TypedOutputBlock, 'id' | 'timestamp'>);
  },

  addSubtitle: (text, source) => {
    get().addBlock({ type: 'subtitle', content: text, source } as Omit<TypedOutputBlock, 'id' | 'timestamp'>);
  },

  addTable: (table, source) => {
    get().addBlock({ type: 'table', content: table, source } as Omit<TypedOutputBlock, 'id' | 'timestamp'>);
  },

  addText: (text, source) => {
    get().addBlock({ type: 'text', content: text, source } as Omit<TypedOutputBlock, 'id' | 'timestamp'>);
  },

  addPlot: (plot, source) => {
    get().addBlock({ type: 'plot', content: plot, source } as Omit<TypedOutputBlock, 'id' | 'timestamp'>);
  },

  addProcessDiagram: (diagram, source) => {
    get().addBlock({ type: 'process-diagram', content: diagram, source } as Omit<TypedOutputBlock, 'id' | 'timestamp'>);
  },

  addWarning: (text) => {
    get().addBlock({ type: 'warning', content: text } as Omit<TypedOutputBlock, 'id' | 'timestamp'>);
  },

  addError: (text) => {
    get().addBlock({ type: 'error', content: text } as Omit<TypedOutputBlock, 'id' | 'timestamp'>);
  },

  clearOutput: () => {
    get().clearAllSessions();
  },

  setLoading: (loading, analysis) => {
    set({ isLoading: loading, currentAnalysis: analysis ?? null });
  },

  exportToHtml: (sessionId) => {
    const { sessions, selectedSessionId } = get();
    const targetId = sessionId ?? selectedSessionId;
    const session = sessions.find((s) => s.id === targetId);
    const blocks = session?.blocks ?? [];

    const styles = `
      <style>
        body { font-family: 'Times New Roman', serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .block { margin-bottom: 20px; }
        .title { font-size: 14pt; font-weight: bold; margin-bottom: 10px; }
        .subtitle { font-size: 12pt; font-weight: bold; margin-bottom: 8px; }
        .table { border-collapse: collapse; width: 100%; font-size: 10pt; }
        .table th, .table td { border: 1px solid #000; padding: 4px 8px; text-align: right; }
        .table th { background: #f0f0f0; font-weight: bold; }
        .text { font-size: 10pt; white-space: pre-wrap; }
        .warning { color: #856404; background: #fff3cd; padding: 10px; border-radius: 4px; }
        .error { color: #721c24; background: #f8d7da; padding: 10px; border-radius: 4px; }
        .plot img { max-width: 100%; }
        .timestamp { font-size: 8pt; color: #666; }
      </style>
    `;

    const content = blocks.map((block) => {
      const timestamp = block.timestamp.toLocaleString();
      switch (block.type) {
        case 'title':
          return `<div class="block"><div class="title">${block.content}</div><div class="timestamp">${timestamp}</div></div>`;
        case 'subtitle':
          return `<div class="block"><div class="subtitle">${block.content}</div></div>`;
        case 'table': {
          const table = block.content as TableOutput;
          const headers = table.headers.map((h) => `<th>${h}</th>`).join('');
          const rows = table.rows.map((row) => `<tr>${row.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('');
          const footnotes = table.footnotes?.map((f) => `<div class="footnote">${f}</div>`).join('') ?? '';
          return `<div class="block"><table class="table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>${footnotes}</div>`;
        }
        case 'text':
        case 'note':
          return `<div class="block"><div class="text">${block.content}</div></div>`;
        case 'plot': {
          const plot = block.content as PlotOutput;
          return `<div class="block plot"><img src="${plot.imageDataUri}" alt="${plot.altText ?? 'Plot'}" /></div>`;
        }
        case 'warning':
          return `<div class="block warning">${block.content}</div>`;
        case 'error':
          return `<div class="block error">${block.content}</div>`;
        default:
          return '';
      }
    }).join('\n');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Method Studio Output</title>${styles}</head><body>${content}</body></html>`;
  },
}));

// Re-export types for convenience
export type { TypedOutputBlock, TableOutput, PlotOutput, ProcessDiagramOutput };
