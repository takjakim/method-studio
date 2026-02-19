/**
 * Analysis specification type definitions for Method Studio.
 * Defines the contract between UI dialogs and analysis engine adapters.
 */

export interface AnalysisSpec {
  id: string;
  name: string;
  category: 'descriptive' | 'compare-means' | 'correlation' | 'regression' | 'sem' | 'process';
  variables: VariableSlot[];
  options: OptionSpec[];
  /** Human-readable description shown in the analysis menu */
  description?: string;
}

export interface VariableSlot {
  id: string;
  label: string;
  /** Which dataset variable types this slot accepts */
  accepts: ('numeric' | 'string' | 'any')[];
  /** Whether multiple variables can be dropped into this slot */
  multiple: boolean;
  required: boolean;
  /** Minimum number of variables required when multiple=true; undefined means no minimum */
  minVariables?: number;
  /** Maximum number of variables when multiple=true; undefined means no limit */
  maxVariables?: number;
  /** Short hint shown inside the drop zone */
  hint?: string;
}

export interface OptionSpec {
  id: string;
  type: 'checkbox' | 'radio' | 'select' | 'number';
  label: string;
  default: unknown;
  choices?: { value: unknown; label: string }[];
  /** Minimum value when type='number' */
  min?: number;
  /** Maximum value when type='number' */
  max?: number;
  /** Step increment when type='number' */
  step?: number;
  /** Group heading for visual organisation */
  group?: string;
}

/**
 * Slot assignment: maps slot IDs to variable names.
 * Basic slots use string[], but complex analyses (SEM, multi-group)
 * may use nested structures.
 */
export type SlotAssignment = Record<string, unknown>;

/**
 * A fully resolved request produced from an AnalysisSpec + user selections.
 * This is what gets dispatched to an engine adapter.
 */
export interface AnalysisRequest {
  specId: string;
  /**
   * Variable assignments for analysis.
   * Basic analyses: Record<slotId, string[]>
   * Complex analyses (SEM/CFA): may include nested objects like factors, paths
   */
  variables: SlotAssignment;
  options: Record<string, unknown>;    // optionId -> chosen value
  engine: 'r' | 'python';
  datasetName: string;
}
