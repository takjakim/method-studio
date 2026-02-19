/**
 * Output block types for the Method Studio output viewer.
 * Modelled on SPSS Navigator-style hierarchical output.
 */

export interface OutputBlock {
  id: string;
  type: 'title' | 'subtitle' | 'table' | 'text' | 'plot' | 'warning' | 'error' | 'note' | 'process-diagram';
  content: unknown;
  timestamp: Date;
  /** Analysis that produced this block */
  source?: string;
}

export interface TitleBlock extends OutputBlock {
  type: 'title' | 'subtitle';
  content: string;
}

export interface TextBlock extends OutputBlock {
  type: 'text' | 'note';
  content: string;
}

export interface WarningBlock extends OutputBlock {
  type: 'warning' | 'error';
  content: string;
}

export interface TableOutput {
  title?: string;
  headers: string[];
  /** Optional second header row for spanning (SPSS-style layered headers) */
  subHeaders?: string[];
  rows: (string | number | null)[][];
  footnotes?: string[];
  /** Column alignment: 'left' | 'right' | 'center'. Defaults to right for numbers */
  columnAlignment?: ('left' | 'right' | 'center')[];
}

export interface TableBlock extends OutputBlock {
  type: 'table';
  content: TableOutput;
}

export interface PlotOutput {
  title?: string;
  /** Base64-encoded PNG data URI */
  imageDataUri: string;
  altText?: string;
  width?: number;
  height?: number;
}

export interface PlotBlock extends OutputBlock {
  type: 'plot';
  content: PlotOutput;
}

/** PROCESS model diagram output (mediation, moderation, etc.) */
export interface ProcessDiagramOutput {
  modelType: 'mediation' | 'moderation' | 'moderated-mediation' | 'serial-mediation' | 'model-8' | 'model-58' | 'model-59';
  variables: {
    x?: string;
    y?: string;
    m?: string;
    m1?: string;
    m2?: string;
    w?: string;
  };
  coefficients?: {
    a?: number;
    a1?: number;
    a2?: number;
    b?: number;
    b1?: number;
    b2?: number;
    c?: number;
    cPrime?: number;
    interaction?: number;
  };
  pValues?: Record<string, number>;
  confidence?: Record<string, [number, number]>;
}

export interface ProcessDiagramBlock extends OutputBlock {
  type: 'process-diagram';
  content: ProcessDiagramOutput;
}

/** Union of all concrete block types */
export type TypedOutputBlock =
  | TitleBlock
  | TextBlock
  | WarningBlock
  | TableBlock
  | PlotBlock
  | ProcessDiagramBlock;
