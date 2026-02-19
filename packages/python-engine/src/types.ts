/**
 * Request payload sent to the Python engine.
 */
export interface PythonRequest {
  /** Unique identifier for the request */
  id: string;
  /** Python script content to execute */
  script: string;
  /** Optional data passed as variables into the script namespace */
  data?: Record<string, unknown>;
  /** Python packages required for the script (will be auto-imported if available) */
  packages?: string[];
}

/**
 * Response returned from the Python engine after script execution.
 */
export interface PythonResponse {
  /** Matches the request id */
  id: string;
  /** Whether execution completed without error */
  success: boolean;
  /** Return value serialized from the Python 'result' variable */
  result?: unknown;
  /** Error message if success is false */
  error?: string;
  /** Captured stdout from the script */
  output?: string;
  /** Base64-encoded PNG plots captured from matplotlib */
  plots?: string[];
}

/**
 * Configuration for the Python engine instance.
 */
export interface PythonEngineConfig {
  /** Path to the Python executable; defaults to system 'python3' */
  pythonPath?: string;
  /** Execution timeout in milliseconds; defaults to 30000 */
  timeout?: number;
  /** Pre-installed packages expected to be available in the environment */
  packages: string[];
}

/**
 * Serialized form of a pandas DataFrame for transport.
 */
export interface SerializedDataFrame {
  __type: 'DataFrame';
  columns: string[];
  index: unknown[];
  data: unknown[][];
}

/**
 * Serialized form of a numpy ndarray for transport.
 */
export interface SerializedNdarray {
  __type: 'ndarray';
  dtype: string;
  shape: number[];
  data: unknown[];
}

/**
 * Internal wire format exchanged between the JS engine and Python wrapper.
 */
export interface WireRequest {
  id: string;
  script: string;
  data: Record<string, unknown>;
  packages: string[];
}

export interface WireResponse {
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
  traceback?: string;
  output?: string;
  plots?: string[];
}
