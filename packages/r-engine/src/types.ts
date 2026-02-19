/**
 * R Engine type definitions for Method Studio
 */

export interface RRequest {
  id: string;
  script: string;
  data?: Record<string, unknown>;
  packages?: string[];
}

export interface RResponse {
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
  output?: string; // console output (stdout + stderr from R)
  plots?: string[]; // base64 encoded PNG plots
}

export interface REngineConfig {
  rPath?: string;          // path to R executable, defaults to system R
  timeout?: number;        // execution timeout in ms, defaults to 30000
  packages: string[];      // packages to pre-load on startup
}

/**
 * Internal JSON-RPC style message envelope used by the communication protocol
 */
export interface RpcMessage {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: RpcParams;
}

export interface RpcParams {
  script: string;
  data?: Record<string, unknown>;
  packages?: string[];
}

export interface RpcResult {
  jsonrpc: '2.0';
  id: string;
  result?: RpcResultPayload;
  error?: RpcError;
}

export interface RpcResultPayload {
  value: unknown;
  output: string;
  plots: string[];
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * R data types that require special serialization
 */
export type RFactor = {
  __type: 'factor';
  levels: string[];
  values: number[];
};

export type RDataFrame = {
  __type: 'data.frame';
  columns: Record<string, unknown[]>;
  nrow: number;
  ncol: number;
};

export type RMatrix = {
  __type: 'matrix';
  data: number[];
  nrow: number;
  ncol: number;
  dimnames?: [string[] | null, string[] | null];
};

export type RSpecialValue = RFactor | RDataFrame | RMatrix;

/**
 * Engine status for lifecycle management
 */
export type REngineStatus = 'uninitialized' | 'initializing' | 'ready' | 'busy' | 'error' | 'stopped';
