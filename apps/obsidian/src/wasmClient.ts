import type {
  AppEvent,
  CommandEntry,
  DelimiterStyle,
  DispatchResponse,
  EngineClient,
  EngineSnapshot,
  PresetEntry,
} from '@mathslot/ui';

export interface CatalogPayload {
  schema_version: number;
  commands: CommandEntry[];
}

export interface PresetsPayload {
  schema_version: number;
  presets: PresetEntry[];
}
import { decodeEmbeddedWasmBytes } from './wasmInline';
import initWasm, { Engine as WasmEngine } from './wasm-pkg/mathslot_wasm.js';

export const EXPECTED_ENGINE_VERSION = '0.7.0+schema1';

export interface WasmClientOptions {
  expectedVersion?: string;
  wasmBytes?: Uint8Array;
}

export class WasmEngineClient implements EngineClient {
  private engine: WasmEngine | null;
  private readonly version: string;
  private readonly listeners = new Set<(response: DispatchResponse) => void>();

  private constructor(engine: WasmEngine, version: string) {
    this.engine = engine;
    this.version = version;
  }

  static async create(options: WasmClientOptions = {}): Promise<WasmEngineClient> {
    const wasmBytes = options.wasmBytes ?? decodeEmbeddedWasmBytes();
    await initWasm({ module_or_path: wasmBytes });

    const actualVersion = WasmEngine.engineVersion();
    const expected = options.expectedVersion ?? EXPECTED_ENGINE_VERSION;
    if (actualVersion !== expected) {
      throw new Error(
        `MathSlot WASM engine version mismatch: expected "${expected}", got "${actualVersion}".`,
      );
    }

    const engine = new WasmEngine();
    return new WasmEngineClient(engine, actualVersion);
  }

  private requireEngine(): WasmEngine {
    if (!this.engine) {
      throw new Error('WasmEngineClient has been disposed.');
    }
    return this.engine;
  }

  subscribe(listener: (response: DispatchResponse) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async engineVersion(): Promise<string> {
    this.requireEngine();
    return this.version;
  }

  async dispatch(event: AppEvent): Promise<DispatchResponse> {
    const engine = this.requireEngine();
    const raw = engine.dispatch(JSON.stringify(event));
    const parsed = JSON.parse(raw) as DispatchResponse;
    for (const listener of this.listeners) {
      listener(parsed);
    }
    return parsed;
  }

  async snapshot(): Promise<EngineSnapshot> {
    const engine = this.requireEngine();
    return JSON.parse(engine.snapshot()) as EngineSnapshot;
  }

  async catalog(): Promise<CatalogPayload> {
    const engine = this.requireEngine();
    return JSON.parse(engine.catalogJson()) as CatalogPayload;
  }

  async presets(): Promise<PresetsPayload> {
    const engine = this.requireEngine();
    return JSON.parse(engine.presetsJson()) as PresetsPayload;
  }

  async wrapLatex(latex: string, style: DelimiterStyle): Promise<string> {
    const engine = this.requireEngine();
    return engine.wrapLatex(latex, style);
  }

  isDisposed(): boolean {
    return this.engine === null;
  }

  dispose(): void {
    if (this.engine) {
      this.engine.free();
      this.engine = null;
      this.listeners.clear();
    }
  }
}
