import { create } from 'zustand';
import { Dataset, Variable, HistoryAction } from '../types/data';

const MAX_HISTORY = 50;

interface DataStore {
  // State
  dataset: Dataset | null;
  activeVariableIndex: number | null;
  selectedRows: number[];
  selectedColumns: string[];
  isDirty: boolean;
  history: HistoryAction[];
  historyIndex: number;

  // Dataset actions
  setDataset: (dataset: Dataset) => void;
  clearDataset: () => void;

  // Variable (column) actions
  setActiveVariable: (index: number | null) => void;
  addVariable: (variable: Variable) => void;
  updateVariable: (index: number, variable: Variable) => void;
  deleteVariable: (index: number) => void;
  reorderVariables: (fromIndex: number, toIndex: number) => void;

  // Row actions
  addRow: () => void;
  deleteRow: (index: number) => void;
  setCell: (row: number, col: string, value: unknown) => void;

  // Selection
  setSelectedRows: (rows: number[]) => void;
  setSelectedColumns: (cols: string[]) => void;

  // Import/Export (placeholders)
  importCSV: (filePath: string) => Promise<void>;
  importExcel: (filePath: string) => Promise<void>;
  exportCSV: (filePath: string) => Promise<void>;
  exportExcel: (filePath: string) => Promise<void>;
  exportSAV: (filePath: string) => Promise<void>;

  // Sample data loading
  loadSampleData: (filename: string) => Promise<void>;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

function createEmptyDataset(name = 'Untitled'): Dataset {
  return {
    name,
    variables: [],
    data: [],
    metadata: {
      createdAt: new Date(),
      modifiedAt: new Date(),
    },
  };
}

function defaultVariable(name: string): Variable {
  return {
    name,
    type: 'numeric',
    label: '',
    values: {},
    missing: [],
    width: 8,
    decimals: 2,
    measure: 'scale',
  };
}

export const useDataStore = create<DataStore>((set, get) => ({
  dataset: null,
  activeVariableIndex: null,
  selectedRows: [],
  selectedColumns: [],
  isDirty: false,
  history: [],
  historyIndex: -1,

  setDataset: (dataset) => {
    set({ dataset, isDirty: false, history: [], historyIndex: -1 });
  },

  clearDataset: () => {
    set({
      dataset: null,
      activeVariableIndex: null,
      selectedRows: [],
      selectedColumns: [],
      isDirty: false,
      history: [],
      historyIndex: -1,
    });
  },

  setActiveVariable: (index) => {
    set({ activeVariableIndex: index });
  },

  addVariable: (variable) => {
    const { dataset } = get();
    if (!dataset) return;

    const action: HistoryAction = { type: 'ADD_VARIABLE', variable };
    const updatedDataset: Dataset = {
      ...dataset,
      variables: [...dataset.variables, variable],
      // Add empty value for this column in all existing rows
      data: dataset.data.map((row) => ({ ...row, [variable.name]: null })),
      metadata: { ...dataset.metadata, modifiedAt: new Date() },
    };

    set((state) => ({
      dataset: updatedDataset,
      isDirty: true,
      history: [
        ...state.history.slice(0, state.historyIndex + 1),
        action,
      ].slice(-MAX_HISTORY),
      historyIndex: Math.min(state.historyIndex + 1, MAX_HISTORY - 1),
    }));
  },

  updateVariable: (index, variable) => {
    const { dataset } = get();
    if (!dataset || index < 0 || index >= dataset.variables.length) return;

    const oldVariable = dataset.variables[index];
    const action: HistoryAction = {
      type: 'UPDATE_VARIABLE',
      index,
      oldVariable,
      newVariable: variable,
    };

    // If name changed, update data keys
    let newData = dataset.data;
    if (oldVariable.name !== variable.name) {
      newData = dataset.data.map((row) => {
        const newRow = { ...row };
        newRow[variable.name] = newRow[oldVariable.name];
        delete newRow[oldVariable.name];
        return newRow;
      });
    }

    const updatedVariables = [...dataset.variables];
    updatedVariables[index] = variable;

    const updatedDataset: Dataset = {
      ...dataset,
      variables: updatedVariables,
      data: newData,
      metadata: { ...dataset.metadata, modifiedAt: new Date() },
    };

    set((state) => ({
      dataset: updatedDataset,
      isDirty: true,
      history: [
        ...state.history.slice(0, state.historyIndex + 1),
        action,
      ].slice(-MAX_HISTORY),
      historyIndex: Math.min(state.historyIndex + 1, MAX_HISTORY - 1),
    }));
  },

  deleteVariable: (index) => {
    const { dataset } = get();
    if (!dataset || index < 0 || index >= dataset.variables.length) return;

    const variable = dataset.variables[index];
    const action: HistoryAction = { type: 'DELETE_VARIABLE', index, variable };

    const updatedVariables = dataset.variables.filter((_, i) => i !== index);
    const updatedData = dataset.data.map((row) => {
      const newRow = { ...row };
      delete newRow[variable.name];
      return newRow;
    });

    set((state) => ({
      dataset: {
        ...dataset,
        variables: updatedVariables,
        data: updatedData,
        metadata: { ...dataset.metadata, modifiedAt: new Date() },
      },
      isDirty: true,
      activeVariableIndex:
        state.activeVariableIndex === index ? null : state.activeVariableIndex,
      history: [
        ...state.history.slice(0, state.historyIndex + 1),
        action,
      ].slice(-MAX_HISTORY),
      historyIndex: Math.min(state.historyIndex + 1, MAX_HISTORY - 1),
    }));
  },

  reorderVariables: (fromIndex, toIndex) => {
    const { dataset } = get();
    if (!dataset) return;

    const variables = [...dataset.variables];
    const [moved] = variables.splice(fromIndex, 1);
    variables.splice(toIndex, 0, moved);

    set({
      dataset: {
        ...dataset,
        variables,
        metadata: { ...dataset.metadata, modifiedAt: new Date() },
      },
      isDirty: true,
    });
  },

  addRow: () => {
    const { dataset } = get();
    if (!dataset) return;

    const emptyRow: Record<string, unknown> = {};
    dataset.variables.forEach((v) => {
      emptyRow[v.name] = null;
    });

    const newIndex = dataset.data.length;
    const action: HistoryAction = { type: 'ADD_ROW', index: newIndex };

    set((state) => ({
      dataset: {
        ...dataset,
        data: [...dataset.data, emptyRow],
        metadata: { ...dataset.metadata, modifiedAt: new Date() },
      },
      isDirty: true,
      history: [
        ...state.history.slice(0, state.historyIndex + 1),
        action,
      ].slice(-MAX_HISTORY),
      historyIndex: Math.min(state.historyIndex + 1, MAX_HISTORY - 1),
    }));
  },

  deleteRow: (index) => {
    const { dataset } = get();
    if (!dataset || index < 0 || index >= dataset.data.length) return;

    const rowData = dataset.data[index];
    const action: HistoryAction = { type: 'DELETE_ROW', index, data: rowData };

    set((state) => ({
      dataset: {
        ...dataset,
        data: dataset.data.filter((_, i) => i !== index),
        metadata: { ...dataset.metadata, modifiedAt: new Date() },
      },
      isDirty: true,
      selectedRows: state.selectedRows.filter((r) => r !== index),
      history: [
        ...state.history.slice(0, state.historyIndex + 1),
        action,
      ].slice(-MAX_HISTORY),
      historyIndex: Math.min(state.historyIndex + 1, MAX_HISTORY - 1),
    }));
  },

  setCell: (row, col, value) => {
    const { dataset } = get();
    if (!dataset || row < 0 || row >= dataset.data.length) return;

    const oldValue = dataset.data[row][col];
    if (oldValue === value) return;

    const action: HistoryAction = { type: 'SET_CELL', row, col, oldValue, newValue: value };
    const newData = [...dataset.data];
    newData[row] = { ...newData[row], [col]: value };

    set((state) => ({
      dataset: {
        ...dataset,
        data: newData,
        metadata: { ...dataset.metadata, modifiedAt: new Date() },
      },
      isDirty: true,
      history: [
        ...state.history.slice(0, state.historyIndex + 1),
        action,
      ].slice(-MAX_HISTORY),
      historyIndex: Math.min(state.historyIndex + 1, MAX_HISTORY - 1),
    }));
  },

  setSelectedRows: (rows) => set({ selectedRows: rows }),
  setSelectedColumns: (cols) => set({ selectedColumns: cols }),

  // Import/Export placeholders
  importCSV: async (_filePath: string) => {
    // TODO: Implement CSV import via Tauri command
    const mockDataset = createEmptyDataset('Imported CSV');
    mockDataset.variables = [
      defaultVariable('var1'),
      defaultVariable('var2'),
    ];
    mockDataset.data = [
      { var1: 1, var2: 2 },
      { var1: 3, var2: 4 },
    ];
    get().setDataset(mockDataset);
  },

  // Load sample data from public folder
  loadSampleData: async (filename: string) => {
    try {
      const response = await fetch(`/sample-data/${filename}`);
      if (!response.ok) throw new Error('Failed to fetch sample data');

      const csvText = await response.text();
      const lines = csvText.trim().split('\n');
      if (lines.length < 2) throw new Error('Invalid CSV');

      const headers = lines[0].split(',').map(h => h.trim());
      const dataset = createEmptyDataset(filename.replace('.csv', ''));

      // Create variables from headers
      dataset.variables = headers.map(name => {
        const variable = defaultVariable(name);
        return variable;
      });

      // Parse data rows
      dataset.data = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        const row: Record<string, unknown> = {};
        headers.forEach((header, i) => {
          const val = values[i];
          // Try to parse as number
          const num = parseFloat(val);
          row[header] = isNaN(num) ? val : num;
        });
        return row;
      });

      // Infer variable types from data
      dataset.variables = dataset.variables.map(variable => {
        const values = dataset.data.map(row => row[variable.name]);
        const allNumeric = values.every(v => v === null || v === '' || typeof v === 'number');
        return {
          ...variable,
          type: allNumeric ? 'numeric' : 'string',
          measure: allNumeric ? 'scale' : 'nominal',
        };
      });

      get().setDataset(dataset);
    } catch (error) {
      console.error('Error loading sample data:', error);
    }
  },

  importExcel: async (_filePath: string) => {
    // TODO: Implement Excel import via Tauri command
    const mockDataset = createEmptyDataset('Imported Excel');
    get().setDataset(mockDataset);
  },

  exportCSV: async (_filePath: string) => {
    // TODO: Implement CSV export via Tauri command
    const { dataset } = get();
    if (!dataset) return;
    console.log('Exporting CSV:', dataset.name);
  },

  exportExcel: async (_filePath: string) => {
    // TODO: Implement Excel export via Tauri command
    const { dataset } = get();
    if (!dataset) return;
    console.log('Exporting Excel:', dataset.name);
  },

  exportSAV: async (_filePath: string) => {
    // TODO: Implement SPSS SAV export via Tauri command
    const { dataset } = get();
    if (!dataset) return;
    console.log('Exporting SAV:', dataset.name);
  },

  undo: () => {
    const { history, historyIndex, dataset } = get();
    if (historyIndex < 0 || !dataset) return;

    const action = history[historyIndex];

    // Reverse the action
    switch (action.type) {
      case 'SET_CELL': {
        const newData = [...dataset.data];
        newData[action.row] = { ...newData[action.row], [action.col]: action.oldValue };
        set({
          dataset: { ...dataset, data: newData },
          historyIndex: historyIndex - 1,
          isDirty: true,
        });
        break;
      }
      case 'ADD_ROW': {
        set({
          dataset: {
            ...dataset,
            data: dataset.data.filter((_, i) => i !== action.index),
          },
          historyIndex: historyIndex - 1,
          isDirty: true,
        });
        break;
      }
      case 'DELETE_ROW': {
        const newData = [...dataset.data];
        newData.splice(action.index, 0, action.data);
        set({
          dataset: { ...dataset, data: newData },
          historyIndex: historyIndex - 1,
          isDirty: true,
        });
        break;
      }
      case 'ADD_VARIABLE': {
        set({
          dataset: {
            ...dataset,
            variables: dataset.variables.filter(
              (v) => v.name !== action.variable.name
            ),
            data: dataset.data.map((row) => {
              const newRow = { ...row };
              delete newRow[action.variable.name];
              return newRow;
            }),
          },
          historyIndex: historyIndex - 1,
          isDirty: true,
        });
        break;
      }
      case 'DELETE_VARIABLE': {
        const variables = [...dataset.variables];
        variables.splice(action.index, 0, action.variable);
        set({
          dataset: {
            ...dataset,
            variables,
            data: dataset.data.map((row) => ({
              ...row,
              [action.variable.name]: null,
            })),
          },
          historyIndex: historyIndex - 1,
          isDirty: true,
        });
        break;
      }
      case 'UPDATE_VARIABLE': {
        const variables = [...dataset.variables];
        variables[action.index] = action.oldVariable;
        let newData = dataset.data;
        if (action.oldVariable.name !== action.newVariable.name) {
          newData = dataset.data.map((row) => {
            const newRow = { ...row };
            newRow[action.oldVariable.name] = newRow[action.newVariable.name];
            delete newRow[action.newVariable.name];
            return newRow;
          });
        }
        set({
          dataset: { ...dataset, variables, data: newData },
          historyIndex: historyIndex - 1,
          isDirty: true,
        });
        break;
      }
    }
  },

  redo: () => {
    const { history, historyIndex, dataset } = get();
    if (historyIndex >= history.length - 1 || !dataset) return;

    const action = history[historyIndex + 1];

    switch (action.type) {
      case 'SET_CELL': {
        const newData = [...dataset.data];
        newData[action.row] = { ...newData[action.row], [action.col]: action.newValue };
        set({
          dataset: { ...dataset, data: newData },
          historyIndex: historyIndex + 1,
          isDirty: true,
        });
        break;
      }
      case 'ADD_ROW': {
        const emptyRow: Record<string, unknown> = {};
        dataset.variables.forEach((v) => { emptyRow[v.name] = null; });
        set({
          dataset: { ...dataset, data: [...dataset.data, emptyRow] },
          historyIndex: historyIndex + 1,
          isDirty: true,
        });
        break;
      }
      case 'DELETE_ROW': {
        set({
          dataset: {
            ...dataset,
            data: dataset.data.filter((_, i) => i !== action.index),
          },
          historyIndex: historyIndex + 1,
          isDirty: true,
        });
        break;
      }
      case 'ADD_VARIABLE': {
        set({
          dataset: {
            ...dataset,
            variables: [...dataset.variables, action.variable],
            data: dataset.data.map((row) => ({
              ...row,
              [action.variable.name]: null,
            })),
          },
          historyIndex: historyIndex + 1,
          isDirty: true,
        });
        break;
      }
      case 'DELETE_VARIABLE': {
        set({
          dataset: {
            ...dataset,
            variables: dataset.variables.filter(
              (v) => v.name !== action.variable.name
            ),
            data: dataset.data.map((row) => {
              const newRow = { ...row };
              delete newRow[action.variable.name];
              return newRow;
            }),
          },
          historyIndex: historyIndex + 1,
          isDirty: true,
        });
        break;
      }
      case 'UPDATE_VARIABLE': {
        const variables = [...dataset.variables];
        variables[action.index] = action.newVariable;
        let newData = dataset.data;
        if (action.oldVariable.name !== action.newVariable.name) {
          newData = dataset.data.map((row) => {
            const newRow = { ...row };
            newRow[action.newVariable.name] = newRow[action.oldVariable.name];
            delete newRow[action.oldVariable.name];
            return newRow;
          });
        }
        set({
          dataset: { ...dataset, variables, data: newData },
          historyIndex: historyIndex + 1,
          isDirty: true,
        });
        break;
      }
    }
  },

  canUndo: () => get().historyIndex >= 0,
  canRedo: () => get().historyIndex < get().history.length - 1,
}));

// Convenience: initialize with an empty dataset on first use
export function initializeEmptyDataset() {
  const store = useDataStore.getState();
  if (!store.dataset) {
    const empty = createEmptyDataset('New Dataset');
    // Add a default variable
    empty.variables.push({
      name: 'var1',
      type: 'numeric',
      label: '',
      values: {},
      missing: [],
      width: 8,
      decimals: 2,
      measure: 'scale',
    });
    empty.data = Array.from({ length: 10 }, () => ({ var1: null }));
    store.setDataset(empty);
  }
}
