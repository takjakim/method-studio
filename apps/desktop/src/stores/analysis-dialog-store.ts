import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface DialogState {
  slots: Record<string, string[]>;
  options: Record<string, unknown>;
  engine: 'r' | 'python';
}

interface AnalysisDialogStore {
  /** Persisted state per specId */
  dialogStates: Record<string, DialogState>;

  /** Get saved state for a spec, returns undefined if none saved */
  getDialogState: (specId: string) => DialogState | undefined;

  /** Save state for a spec */
  saveDialogState: (specId: string, state: DialogState) => void;

  /** Clear state for a spec */
  clearDialogState: (specId: string) => void;

  /** Clear all saved states */
  clearAllDialogStates: () => void;
}

export const useAnalysisDialogStore = create<AnalysisDialogStore>()(
  persist(
    (set, get) => ({
      dialogStates: {},

      getDialogState: (specId) => {
        return get().dialogStates[specId];
      },

      saveDialogState: (specId, state) => {
        set((prev) => ({
          dialogStates: {
            ...prev.dialogStates,
            [specId]: state,
          },
        }));
      },

      clearDialogState: (specId) => {
        set((prev) => {
          const { [specId]: _, ...rest } = prev.dialogStates;
          return { dialogStates: rest };
        });
      },

      clearAllDialogStates: () => {
        set({ dialogStates: {} });
      },
    }),
    {
      name: 'method-studio-dialog-states',
    }
  )
);
