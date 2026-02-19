/**
 * @method-studio/python-engine
 *
 * Python engine integration layer for Method Studio.
 * Communicates with a Python subprocess via Tauri sidecar pattern.
 */

export { PythonEngine } from './engine.js';
export { serializeRequest, parseWireResponse, deserializeResponse } from './protocol.js';
export type {
  PythonRequest,
  PythonResponse,
  PythonEngineConfig,
  SerializedDataFrame,
  SerializedNdarray,
  WireRequest,
  WireResponse,
} from './types.js';
