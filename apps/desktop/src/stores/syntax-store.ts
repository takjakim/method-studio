import { create } from 'zustand';

export interface ScriptEntry {
  id: string;
  timestamp: Date;
  specId: string;
  engine: 'r' | 'python';
  script: string;
  scriptSummary?: string;
  success: boolean;
}

interface SyntaxState {
  scripts: ScriptEntry[];
  selectedScriptId: string | null;
}

interface SyntaxActions {
  addScript: (entry: Omit<ScriptEntry, 'id' | 'timestamp'>) => void;
  selectScript: (id: string | null) => void;
  clearScripts: () => void;
  getSelectedScript: () => ScriptEntry | null;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useSyntaxStore = create<SyntaxState & SyntaxActions>((set, get) => ({
  scripts: [],
  selectedScriptId: null,

  addScript: (entry) => {
    const newEntry: ScriptEntry = {
      ...entry,
      id: generateId(),
      timestamp: new Date(),
    };
    set((state) => ({
      scripts: [...state.scripts, newEntry],
      selectedScriptId: newEntry.id,
    }));
  },

  selectScript: (id) => {
    set({ selectedScriptId: id });
  },

  clearScripts: () => {
    set({ scripts: [], selectedScriptId: null });
  },

  getSelectedScript: () => {
    const { scripts, selectedScriptId } = get();
    if (!selectedScriptId) return scripts[scripts.length - 1] ?? null;
    return scripts.find((s) => s.id === selectedScriptId) ?? null;
  },
}));
