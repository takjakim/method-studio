import type {
  PythonRequest,
  WireRequest,
  WireResponse,
  PythonResponse,
  SerializedDataFrame,
  SerializedNdarray,
} from './types.js';

/**
 * Serialize a JS value to a Python-safe JSON-representable value.
 * Handles Date objects, undefined → null, etc.
 */
function serializeValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = serializeValue(v);
    }
    return result;
  }
  return value;
}

/**
 * Convert a JS PythonRequest into the wire format JSON string
 * that the Python wrapper expects on stdin.
 */
export function serializeRequest(request: PythonRequest): string {
  const wire: WireRequest = {
    id: request.id,
    script: request.script,
    data: request.data
      ? (serializeValue(request.data) as Record<string, unknown>)
      : {},
    packages: request.packages ?? [],
  };
  return JSON.stringify(wire);
}

/**
 * Detect whether a value is a serialized pandas DataFrame.
 */
function isDataFrame(value: unknown): value is SerializedDataFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as SerializedDataFrame).__type === 'DataFrame'
  );
}

/**
 * Detect whether a value is a serialized numpy ndarray.
 */
function isNdarray(value: unknown): value is SerializedNdarray {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as SerializedNdarray).__type === 'ndarray'
  );
}

/**
 * Deserialize a DataFrame back to a plain JS object with named columns.
 * Returns an array of row objects for easy consumption.
 */
function deserializeDataFrame(
  df: SerializedDataFrame
): Record<string, unknown>[] {
  return df.data.map((row) => {
    const rowObj: Record<string, unknown> = {};
    df.columns.forEach((col, i) => {
      rowObj[col] = (row as unknown[])[i];
    });
    return rowObj;
  });
}

/**
 * Recursively deserialize any serialized Python types embedded in a value.
 */
function deserializeValue(value: unknown): unknown {
  if (isDataFrame(value)) return deserializeDataFrame(value);
  if (isNdarray(value)) return value.data; // flat representation
  if (Array.isArray(value)) return value.map(deserializeValue);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = deserializeValue(v);
    }
    return result;
  }
  return value;
}

/**
 * Parse raw stdout text from the Python wrapper into a WireResponse.
 * The wrapper guarantees a single JSON object on the last non-empty line.
 */
export function parseWireResponse(raw: string): WireResponse {
  const lines = raw.trim().split('\n');
  // The wrapper writes the JSON envelope as the last line
  const jsonLine = lines[lines.length - 1].trim();
  try {
    return JSON.parse(jsonLine) as WireResponse;
  } catch {
    return {
      id: '',
      success: false,
      error: `Failed to parse Python response: ${jsonLine.slice(0, 200)}`,
    };
  }
}

/**
 * Convert a WireResponse into a typed PythonResponse,
 * deserializing any numpy/pandas structures in the result.
 */
export function deserializeResponse(wire: WireResponse): PythonResponse {
  return {
    id: wire.id,
    success: wire.success,
    result: wire.result !== undefined ? deserializeValue(wire.result) : undefined,
    error: wire.error,
    output: wire.output,
    plots: wire.plots,
  };
}
