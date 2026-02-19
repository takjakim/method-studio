// Core types and utilities for Method Studio

// Variable types
export type VariableType = 'numeric' | 'string' | 'date';
export type MeasureType = 'scale' | 'ordinal' | 'nominal';
export type EngineType = 'r' | 'python';

export interface Variable {
  name: string;
  type: VariableType;
  label?: string;
  values?: Record<string | number, string>; // value labels
  missing?: (string | number)[];
  width: number;
  decimals: number;
  measure: MeasureType;
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

export interface EngineResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  output?: string;
  plots?: string[];
  duration?: number;
}

export interface AnalysisResult {
  id: string;
  type: string;
  engine: EngineType;
  timestamp: Date;
  input: Record<string, unknown>;
  output: EngineResult;
}

// Utility functions
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
