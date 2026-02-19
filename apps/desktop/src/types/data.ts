export interface Variable {
  name: string;
  type: 'numeric' | 'string' | 'date';
  label?: string;
  values?: Record<string | number, string>; // value labels
  missing?: (string | number)[];
  width: number;
  decimals: number;
  measure: 'scale' | 'ordinal' | 'nominal';
}

export interface Dataset {
  name: string;
  variables: Variable[];
  data: Record<string, unknown>[];
  metadata: {
    createdAt: Date;
    modifiedAt: Date;
    source?: string;
  };
}

export interface DataEditorState {
  dataset: Dataset | null;
  activeVariableIndex: number | null;
  selectedRows: number[];
  selectedColumns: string[];
  isDirty: boolean;
}

export type HistoryAction =
  | { type: 'SET_CELL'; row: number; col: string; oldValue: unknown; newValue: unknown }
  | { type: 'ADD_ROW'; index: number }
  | { type: 'DELETE_ROW'; index: number; data: Record<string, unknown> }
  | { type: 'ADD_VARIABLE'; variable: Variable }
  | { type: 'DELETE_VARIABLE'; index: number; variable: Variable }
  | { type: 'UPDATE_VARIABLE'; index: number; oldVariable: Variable; newVariable: Variable };
