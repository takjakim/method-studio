import { Command } from '@tauri-apps/plugin-shell';
import type { PythonRequest, PythonResponse, PythonEngineConfig } from './types.js';
import { serializeRequest, parseWireResponse, deserializeResponse } from './protocol.js';

/** Default configuration values */
const DEFAULTS: Required<PythonEngineConfig> = {
  pythonPath: 'python3',
  timeout: 30_000,
  packages: [],
};

/**
 * PythonEngine manages communication with a Python subprocess via
 * the Tauri sidecar (plugin-shell Command) pattern.
 *
 * The engine sends JSON requests to the Python wrapper on stdin and
 * reads a single-line JSON response from stdout.
 *
 * Usage:
 *   const engine = new PythonEngine({ packages: ['numpy', 'pandas'] });
 *   const response = await engine.execute({
 *     id: crypto.randomUUID(),
 *     script: 'result = data["x"] + 1',
 *     data: { x: 41 },
 *   });
 */
export class PythonEngine {
  private readonly config: Required<PythonEngineConfig>;
  /** Path to the Python wrapper script, resolved at construction time */
  private readonly wrapperScript: string;

  constructor(config: Partial<PythonEngineConfig> = {}) {
    this.config = { ...DEFAULTS, ...config };
    // The wrapper script ships alongside the Tauri app in the sidecar resource path.
    // At runtime the app resolves this via Tauri's resource directory.
    this.wrapperScript = 'engines/python-scripts/wrapper.py';
  }

  /**
   * Execute a Python script and return the response.
   * Throws if the subprocess cannot be spawned or times out.
   */
  async execute(request: PythonRequest): Promise<PythonResponse> {
    const payload = serializeRequest(request);

    // Spawn the Python interpreter as a Tauri sidecar command.
    // The sidecar name must be registered in tauri.conf.json's allowlist.
    const command = Command.sidecar('python3', [this.wrapperScript], {
      encoding: 'utf-8',
    });

    return new Promise<PythonResponse>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        reject(
          new Error(
            `Python engine timed out after ${this.config.timeout}ms for request ${request.id}`
          )
        );
      }, this.config.timeout);

      command.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });

      command.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      command.on('close', (event: { code: number | null }) => {
        if (timedOut) return;
        clearTimeout(timer);

        if (event.code !== 0 && !stdout.trim()) {
          resolve({
            id: request.id,
            success: false,
            error: stderr.trim() || `Python process exited with code ${event.code}`,
          });
          return;
        }

        try {
          const wire = parseWireResponse(stdout);
          // Ensure the response id matches; if wrapper sent empty id, backfill it
          if (!wire.id) wire.id = request.id;
          resolve(deserializeResponse(wire));
        } catch (err) {
          resolve({
            id: request.id,
            success: false,
            error: `Failed to parse engine response: ${String(err)}`,
            output: stdout.slice(0, 1000),
          });
        }
      });

      command.on('error', (err: Error) => {
        if (timedOut) return;
        clearTimeout(timer);
        reject(err);
      });

      // Spawn the process and write the JSON payload to stdin
      command.spawn().then((child) => {
        child.write(payload + '\n').catch(reject);
      }).catch(reject);
    });
  }

  /**
   * Convenience method: execute a named script file from engines/python-scripts/.
   * The script must read its input from the injected 'data' namespace variable.
   */
  async executeScript(
    scriptName: string,
    data: Record<string, unknown> = {},
    packages: string[] = []
  ): Promise<PythonResponse> {
    const id = this.generateId();
    // We delegate to wrapper.py which accepts a script_path key in the payload
    return this.execute({
      id,
      script: `__script_path__ = '${scriptName}'`,
      data: { ...data, __script_path__: `engines/python-scripts/${scriptName}` },
      packages,
    });
  }

  /**
   * Check whether a Python package is importable in the current environment.
   */
  async isPackageAvailable(packageName: string): Promise<boolean> {
    const response = await this.execute({
      id: this.generateId(),
      script: `
import importlib.util
result = importlib.util.find_spec("${packageName}") is not None
`.trim(),
    });
    return response.success && response.result === true;
  }

  private generateId(): string {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  }
}
