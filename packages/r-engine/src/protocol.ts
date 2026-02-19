/**
 * Communication protocol between TypeScript and R wrapper script.
 *
 * Data flows as JSON over stdin/stdout.
 * The R wrapper reads one JSON message from stdin, executes the script,
 * and writes one JSON result to stdout.
 */

import type {
  RRequest,
  RResponse,
  RpcMessage,
  RpcResult,
  RFactor,
  RDataFrame,
  RMatrix,
  RSpecialValue,
} from './types.js';

/** JSON-RPC error codes */
export const RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  R_EXECUTION_ERROR: -32000,
  TIMEOUT_ERROR: -32001,
  PACKAGE_ERROR: -32002,
} as const;

/**
 * Serialize an RRequest into a JSON-RPC message string for stdin.
 */
export function serializeRequest(req: RRequest): string {
  const message: RpcMessage = {
    jsonrpc: '2.0',
    id: req.id,
    method: 'execute',
    params: {
      script: req.script,
      data: req.data !== undefined ? serializeData(req.data) : undefined,
      packages: req.packages,
    },
  };
  return JSON.stringify(message);
}

/**
 * Parse the JSON-RPC result string from R stdout into an RResponse.
 */
export function parseResponse(raw: string, requestId: string): RResponse {
  let parsed: RpcResult;

  try {
    parsed = JSON.parse(raw) as RpcResult;
  } catch (_err) {
    return {
      id: requestId,
      success: false,
      error: `Failed to parse R output as JSON: ${raw.slice(0, 500)}`,
      output: raw,
    };
  }

  if (parsed.error !== undefined) {
    return {
      id: parsed.id,
      success: false,
      error: parsed.error.message,
      output: parsed.result?.output ?? '',
    };
  }

  if (parsed.result === undefined) {
    return {
      id: parsed.id,
      success: false,
      error: 'R returned empty result',
    };
  }

  return {
    id: parsed.id,
    success: true,
    result: deserializeValue(parsed.result.value),
    output: parsed.result.output,
    plots: parsed.result.plots,
  };
}

/**
 * Recursively serialize a JavaScript value to an R-friendly JSON form.
 * Special JS types are encoded with __type tags that the R wrapper understands.
 */
export function serializeData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = serializeValue(value);
  }
  return result;
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Pass through already-tagged special types
    if (obj.__type === 'factor' || obj.__type === 'data.frame' || obj.__type === 'matrix') {
      return obj;
    }
    // Plain object → serialize each field
    const serialized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      serialized[k] = serializeValue(v);
    }
    return serialized;
  }
  // Fallback: coerce to string
  return String(value);
}

/**
 * Deserialize a value coming back from R into a JavaScript object.
 * Handles special tagged types: factor, data.frame, matrix.
 */
export function deserializeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(deserializeValue);
  }

  const obj = value as Record<string, unknown>;

  if (obj.__type === 'factor') {
    return deserializeFactor(obj as unknown as RFactor);
  }
  if (obj.__type === 'data.frame') {
    return deserializeDataFrame(obj as unknown as RDataFrame);
  }
  if (obj.__type === 'matrix') {
    return deserializeMatrix(obj as unknown as RMatrix);
  }

  // Plain object
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = deserializeValue(v);
  }
  return result;
}

function deserializeFactor(factor: RFactor): { levels: string[]; values: string[] } {
  return {
    levels: factor.levels,
    values: factor.values.map((idx) => factor.levels[idx - 1] ?? ''),
  };
}

function deserializeDataFrame(df: RDataFrame): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  for (const [col, values] of Object.entries(df.columns)) {
    result[col] = (values as unknown[]).map(deserializeValue);
  }
  return result;
}

function deserializeMatrix(matrix: RMatrix): {
  data: number[][];
  rownames: string[] | null;
  colnames: string[] | null;
} {
  const rows: number[][] = [];
  for (let r = 0; r < matrix.nrow; r++) {
    const row: number[] = [];
    for (let c = 0; c < matrix.ncol; c++) {
      row.push(matrix.data[r + c * matrix.nrow] ?? 0);
    }
    rows.push(row);
  }
  return {
    data: rows,
    rownames: matrix.dimnames?.[0] ?? null,
    colnames: matrix.dimnames?.[1] ?? null,
  };
}

/**
 * Create a helper for building factor objects to send to R.
 */
export function createFactor(levels: string[], values: string[]): RSpecialValue {
  const factor: RFactor = {
    __type: 'factor',
    levels,
    values: values.map((v) => {
      const idx = levels.indexOf(v);
      return idx === -1 ? 0 : idx + 1;
    }),
  };
  return factor;
}

/**
 * Create a helper for building data frame objects to send to R.
 */
export function createDataFrame(columns: Record<string, unknown[]>): RSpecialValue {
  const colNames = Object.keys(columns);
  const nrow = colNames.length > 0 ? (columns[colNames[0]]?.length ?? 0) : 0;
  const df: RDataFrame = {
    __type: 'data.frame',
    columns,
    nrow,
    ncol: colNames.length,
  };
  return df;
}
