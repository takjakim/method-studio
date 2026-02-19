/**
 * @method-studio/r-engine
 *
 * R engine integration layer for Method Studio.
 * Provides TypeScript bindings for executing R scripts via Tauri sidecar.
 */

// Types
export type {
  RRequest,
  RResponse,
  REngineConfig,
  REngineStatus,
  RpcMessage,
  RpcParams,
  RpcResult,
  RpcResultPayload,
  RpcError,
  RFactor,
  RDataFrame,
  RMatrix,
  RSpecialValue,
} from './types.js';

// Engine
export { REngine, createREngine, RPC_ERROR_CODES } from './engine.js';

// Protocol utilities (useful for testing and custom integrations)
export {
  serializeRequest,
  parseResponse,
  serializeData,
  deserializeValue,
  createFactor,
  createDataFrame,
} from './protocol.js';
