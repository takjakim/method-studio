/**
 * REngine - Manages R process lifecycle and script execution via Tauri sidecar.
 *
 * Uses Tauri's shell/sidecar API to spawn the R wrapper script as a sidecar
 * process. Communication is JSON-RPC over stdin/stdout.
 */

import type { RRequest, RResponse, REngineConfig, REngineStatus } from './types.js';
import { serializeRequest, parseResponse, RPC_ERROR_CODES } from './protocol.js';

/** Default configuration values */
const DEFAULTS: Required<REngineConfig> = {
  rPath: 'R',
  timeout: 30_000,
  packages: [],
};

/** Pending request state tracked while awaiting R response */
interface PendingRequest {
  resolve: (response: RResponse) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

/**
 * REngine provides a high-level API for executing R scripts via Tauri sidecar.
 *
 * Usage:
 * ```ts
 * const engine = new REngine({ packages: ['psych', 'dplyr'] });
 * await engine.initialize();
 * const result = await engine.execute({
 *   id: crypto.randomUUID(),
 *   script: 'mean(x)',
 *   data: { x: [1, 2, 3, 4, 5] },
 * });
 * ```
 */
export class REngine {
  private config: Required<REngineConfig>;
  private status: REngineStatus = 'uninitialized';
  private pendingRequests = new Map<string, PendingRequest>();

  // Tauri sidecar process handle - typed as unknown to avoid hard dep on @tauri-apps/api at module load
  private process: unknown = null;
  private outputBuffer = '';

  constructor(config: REngineConfig) {
    this.config = { ...DEFAULTS, ...config };
  }

  getStatus(): REngineStatus {
    return this.status;
  }

  /**
   * Initialize the R sidecar process.
   * Must be called before executing any scripts.
   */
  async initialize(): Promise<void> {
    if (this.status === 'ready' || this.status === 'initializing') {
      return;
    }

    this.status = 'initializing';

    try {
      // Dynamically import Tauri API to avoid breaking non-Tauri environments
      const { Command } = await import('@tauri-apps/api/shell' as string) as {
        Command: {
          sidecar: (name: string, args: string[]) => {
            spawn: () => Promise<unknown>;
          };
        };
      };

      const wrapperArgs = [
        '--rpath', this.config.rPath,
        '--packages', this.config.packages.join(','),
      ];

      const command = Command.sidecar('r-wrapper', wrapperArgs);

      // Spawn is typed as returning a ChildProcess-like object
      const proc = await command.spawn() as {
        write: (data: string) => Promise<void>;
        kill: () => Promise<void>;
        stdout: { on: (event: string, cb: (data: string) => void) => void };
        stderr: { on: (event: string, cb: (data: string) => void) => void };
        on: (event: string, cb: (code: number | null) => void) => void;
      };

      this.process = proc;
      this.setupOutputHandlers(proc);
      this.status = 'ready';
    } catch (err) {
      this.status = 'error';
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to initialize R engine: ${message}`);
    }
  }

  /**
   * Execute an R script and return the result.
   */
  async execute(request: RRequest): Promise<RResponse> {
    if (this.status !== 'ready') {
      return {
        id: request.id,
        success: false,
        error: `R engine is not ready (status: ${this.status}). Call initialize() first.`,
      };
    }

    return new Promise<RResponse>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        resolve({
          id: request.id,
          success: false,
          error: `R script execution timed out after ${this.config.timeout}ms`,
        });
      }, this.config.timeout);

      this.pendingRequests.set(request.id, { resolve, reject, timeoutHandle });
      this.sendRequest(request).catch((err: unknown) => {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(request.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /**
   * Execute a named R script file from the bundled engines/r-scripts directory.
   * Wraps the script in a source() call with data pre-loaded.
   */
  async executeScript(
    scriptName: string,
    data?: Record<string, unknown>,
    packages?: string[]
  ): Promise<RResponse> {
    const id = generateId();
    // The wrapper handles script name resolution to bundled path
    const script = `source_bundled("${scriptName}")`;
    return this.execute({ id, script, data, packages });
  }

  /**
   * Run descriptive statistics on a numeric vector.
   */
  async descriptives(
    x: number[],
    options: { label?: string } = {}
  ): Promise<RResponse> {
    const id = generateId();
    return this.execute({
      id,
      script: 'source_bundled("descriptives.R")',
      data: { x, label: options.label ?? 'variable' },
      packages: ['psych'],
    });
  }

  /**
   * Run a t-test.
   */
  async ttest(
    params: {
      type: 'one-sample' | 'independent' | 'paired';
      x: number[];
      y?: number[];
      mu?: number;
      alpha?: number;
    }
  ): Promise<RResponse> {
    const id = generateId();
    return this.execute({
      id,
      script: 'source_bundled("ttest.R")',
      data: {
        test_type: params.type,
        x: params.x,
        y: params.y ?? null,
        mu: params.mu ?? 0,
        alpha: params.alpha ?? 0.05,
      },
    });
  }

  /**
   * Stop the R engine and clean up the sidecar process.
   */
  async stop(): Promise<void> {
    if (this.process === null) {
      this.status = 'stopped';
      return;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeoutHandle);
      pending.resolve({
        id,
        success: false,
        error: 'R engine was stopped',
      });
    }
    this.pendingRequests.clear();

    try {
      const proc = this.process as { kill: () => Promise<void> };
      await proc.kill();
    } catch {
      // Ignore kill errors during shutdown
    }

    this.process = null;
    this.status = 'stopped';
  }

  // ---- Private helpers ----

  private async sendRequest(request: RRequest): Promise<void> {
    const proc = this.process as { write: (data: string) => Promise<void> } | null;
    if (proc === null) {
      throw new Error('No active R process');
    }
    const payload = serializeRequest(request) + '\n';
    await proc.write(payload);
  }

  private setupOutputHandlers(proc: {
    stdout: { on: (event: string, cb: (data: string) => void) => void };
    stderr: { on: (event: string, cb: (data: string) => void) => void };
    on: (event: string, cb: (code: number | null) => void) => void;
  }): void {
    proc.stdout.on('data', (chunk: string) => {
      this.outputBuffer += chunk;
      // Process complete newline-delimited JSON messages
      const lines = this.outputBuffer.split('\n');
      this.outputBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          this.handleRawOutput(trimmed);
        }
      }
    });

    proc.stderr.on('data', (chunk: string) => {
      // R stderr (e.g. startup messages) – attach to output of any pending request
      // This is best-effort; we can't correlate stderr to a specific request id
      for (const pending of this.pendingRequests.values()) {
        // We can't modify the response here without the id, so just log
        void chunk;
        void pending;
      }
    });

    proc.on('close', (code: number | null) => {
      if (this.status !== 'stopped') {
        this.status = 'error';
      }
      // Resolve all pending requests as errors
      for (const [id, pending] of this.pendingRequests.entries()) {
        clearTimeout(pending.timeoutHandle);
        pending.resolve({
          id,
          success: false,
          error: `R process exited with code ${code ?? 'unknown'}`,
        });
      }
      this.pendingRequests.clear();
      this.process = null;
    });
  }

  private handleRawOutput(line: string): void {
    // Try to parse as an RPC response. If the id matches a pending request, resolve it.
    try {
      const parsed = JSON.parse(line) as { id?: string };
      const id = parsed.id;
      if (typeof id === 'string') {
        const pending = this.pendingRequests.get(id);
        if (pending !== undefined) {
          clearTimeout(pending.timeoutHandle);
          this.pendingRequests.delete(id);
          const response = parseResponse(line, id);
          pending.resolve(response);
          return;
        }
      }
    } catch {
      // Not JSON or no matching request – ignore
    }
  }
}

/**
 * Create a pre-configured REngine and initialize it.
 */
export async function createREngine(config: REngineConfig): Promise<REngine> {
  const engine = new REngine(config);
  await engine.initialize();
  return engine;
}

function generateId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Numeric error codes re-exported for consumers that need to inspect errors.
 */
export { RPC_ERROR_CODES };
