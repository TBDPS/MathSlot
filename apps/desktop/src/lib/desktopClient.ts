import { invoke } from '@tauri-apps/api/core';
import initWasm, { Engine as WasmEngine } from '@mathslot/wasm';
import {
  createDefaultAppSettings,
  type AppEvent,
  type AppSettings,
  type DispatchResponse,
  type EngineClient,
  type EngineSnapshot,
  type LatexRustInvokeResult,
  type PreviewRenderRequest,
} from '@mathslot/ui';

declare const __MATHSLOT_TEST_WASM_B64__: string | undefined;

export interface PresetDto {
  id: string;
  legacy_id: string;
  name: string;
  category: string;
  source: string;
  desc: string;
  tags: string[];
}

export interface FormulaEntryDto {
  id: string;
  name: string;
  category: string;
  source: string;
  desc: string;
  tags: string[];
  is_builtin: boolean;
  created_at: number;
}

export interface DesktopHostBridge extends EngineClient {
  isTauri(): boolean;
  renderLatexSvg(req: PreviewRenderRequest): Promise<LatexRustInvokeResult>;
  restoreBackup(backupPath: string | null): Promise<EngineSnapshot>;
  resetEmptyConfig(): Promise<EngineSnapshot>;
  exportConfigJson(): Promise<string>;
  importConfigJson(rawJson: string): Promise<EngineSnapshot>;
  copyToClipboard(text: string): Promise<void>;
  getUserFormulas(): Promise<FormulaEntryDto[]>;
  saveUserFormula(name: string, category: string, source: string, desc: string): Promise<FormulaEntryDto>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __MATHSLOT_DESKTOP_BRIDGE__?: Partial<DesktopHostBridge>;
  }
}

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
}

function createTauriHostBridge(): DesktopHostBridge {
  return {
    isTauri: () => true,
    dispatch: (event: AppEvent) => invoke<DispatchResponse>('dispatch_event', { event }),
    snapshot: () => invoke<EngineSnapshot>('get_snapshot'),
    engineVersion: () => invoke<string>('engine_version'),
    renderLatexSvg: (req: PreviewRenderRequest) =>
      invoke<LatexRustInvokeResult>('render_latex_svg', {
        req: {
          generation: req.generation,
          latex: req.latex,
          previewLatex: req.previewLatex ?? null,
          theme: req.theme,
          scale: req.scale ?? 1.0,
          mode: req.mode ?? 'preview',
        },
      }),
    restoreBackup: (backupPath: string | null) =>
      invoke<EngineSnapshot>('restore_backup', { backupPath }),
    resetEmptyConfig: () => invoke<EngineSnapshot>('reset_empty_config'),
    exportConfigJson: () => invoke<string>('export_config_json'),
    importConfigJson: (rawJson: string) =>
      invoke<EngineSnapshot>('import_config_json', { rawJson }),
    copyToClipboard: (text: string) => invoke<void>('copy_to_clipboard', { text }),
    getUserFormulas: () => invoke<FormulaEntryDto[]>('get_user_formulas'),
    saveUserFormula: (name: string, category: string, source: string, desc: string) =>
      invoke<FormulaEntryDto>('save_user_formula', { name, category, source, desc }),
  };
}

function decodeTestWasmBytes(b64: string): Uint8Array {
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  const nodeBuffer = (
    globalThis as unknown as {
      Buffer?: { from(input: string, encoding: string): ArrayLike<number> };
    }
  ).Buffer;
  if (nodeBuffer) {
    return Uint8Array.from(nodeBuffer.from(b64, 'base64'));
  }
  throw new Error('Base64 decoder unavailable in current runtime.');
}

let wasmInitPromise: Promise<void> | null = null;

async function ensureWasmInitialized(): Promise<void> {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      if (typeof __MATHSLOT_TEST_WASM_B64__ === 'string' && __MATHSLOT_TEST_WASM_B64__.length > 0) {
        await initWasm({ module_or_path: decodeTestWasmBytes(__MATHSLOT_TEST_WASM_B64__) });
      } else {
        await initWasm();
      }
    })();
  }
  await wasmInitPromise;
}

let desktopUidSeq = 0;

function nextDesktopUniqueId(prefix: string): string {
  desktopUidSeq = (desktopUidSeq + 1) & 0xffff;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  const rand = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0');
  return `${prefix}-${Date.now().toString(16)}-${desktopUidSeq.toString(16).padStart(4, '0')}-${rand}`;
}

/**
 * Browser/test fallback host bridge backed by the real Rust `mathslot-wasm` `Engine`
 * (D-143 / D-137: zero JS parser/importer/brace-counting reimplementation).
 */
export function createBrowserHarnessBridge(): DesktopHostBridge {
  let enginePromise: Promise<WasmEngine> | null = null;
  const userFormulas: FormulaEntryDto[] = [];
  const copiedTexts: string[] = [];
  let recoveryActive = false;
  let lastValidBackup: { settings: AppSettings; userFormulas: FormulaEntryDto[] } | null = null;

  async function ensureEngine(): Promise<WasmEngine> {
    if (!enginePromise) {
      enginePromise = (async () => {
        await ensureWasmInitialized();
        const engine = new WasmEngine();
        const initialSettings: AppSettings = {
          ...createDefaultAppSettings(),
          config_path: '~/.config/mathslot/library.json',
        };
        engine.dispatch(JSON.stringify({ UpdateSettings: initialSettings }));
        return engine;
      })();
    }
    return enginePromise;
  }

  async function copyTextSafe(text: string): Promise<void> {
    copiedTexts.push(text);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Headless browser contexts may block clipboard API writes; copiedTexts still tracks it.
      }
    }
  }

  function isWriteEvent(event: AppEvent): boolean {
    if (event === 'ResetSettingsConfirmed' || event === 'RequestSaveSnippet') {
      return true;
    }
    return typeof event === 'object' && event !== null && 'UpdateSettings' in event;
  }

  async function dispatch(event: AppEvent): Promise<DispatchResponse> {
    const engine = await ensureEngine();
    if (recoveryActive && isWriteEvent(event)) {
      throw new Error('存在未解决的配置损坏恢复状态（recovery lock），请先从备份恢复或重置为空配置');
    }

    if (
      typeof event === 'object' &&
      event !== null &&
      'SetRecoveryState' in event &&
      event.SetRecoveryState != null &&
      !recoveryActive
    ) {
      const currentSnap = JSON.parse(engine.snapshot()) as EngineSnapshot;
      lastValidBackup = {
        settings: currentSnap.settings ?? createDefaultAppSettings(),
        userFormulas: userFormulas.map((entry) => ({ ...entry, tags: [...entry.tags] })),
      };
    }

    const raw = engine.dispatch(JSON.stringify(event));
    const parsed = JSON.parse(raw) as DispatchResponse;
    recoveryActive = Boolean(parsed.snapshot.recovery);

    for (const eff of parsed.effects) {
      if (typeof eff === 'object' && eff !== null && 'Clipboard' in eff) {
        await copyTextSafe(eff.Clipboard);
      } else if (typeof eff === 'object' && eff !== null && 'Host' in eff) {
        const host = eff.Host as Record<string, unknown>;
        if ('SaveSnippet' in host) {
          const payload = host.SaveSnippet as { source?: string; latex?: string };
          const snippetSrc = (payload.source ?? '').trim() || (payload.latex ?? '').trim();
          if (snippetSrc.length > 0) {
            userFormulas.push({
              id: nextDesktopUniqueId('snippet'),
              name: `片段 ${snippetSrc.slice(0, 18)}`,
              category: '自定义',
              source: snippetSrc,
              desc: `保存 LaTeX: ${payload.latex ?? snippetSrc}`,
              tags: ['custom', 'snippet'],
              is_builtin: false,
              created_at: Math.floor(Date.now() / 1000),
            });
          }
        }
      }
    }

    if (!recoveryActive && isWriteEvent(event)) {
      lastValidBackup = {
        settings: parsed.snapshot.settings ?? createDefaultAppSettings(),
        userFormulas: userFormulas.map((entry) => ({ ...entry, tags: [...entry.tags] })),
      };
    }

    return parsed;
  }

  async function snapshot(): Promise<EngineSnapshot> {
    const engine = await ensureEngine();
    return JSON.parse(engine.snapshot()) as EngineSnapshot;
  }

  return {
    isTauri: () => false,
    dispatch,
    snapshot,
    engineVersion: async () => {
      await ensureEngine();
      return WasmEngine.engineVersion();
    },
    renderLatexSvg: async (req: PreviewRenderRequest): Promise<LatexRustInvokeResult> => {
      const tex = (req.previewLatex && req.previewLatex.trim().length > 0 ? req.previewLatex : req.latex).trim();
      if (!tex) {
        return { svg: '', degraded: false, diagnostics: [] };
      }
      if (tex.includes('\\unknownFallbackTest')) {
        return {
          svg: '',
          degraded: true,
          diagnostics: [
            {
              code: 'LATEX_RUST_ERROR',
              severity: 'Error',
              summary: '[LATEX_RUST_ERROR] 离线 LaTeX-Rust 不支持测试宏，已自动降级',
              message: '离线 LaTeX-Rust 不支持测试宏',
              sourceExcerpt: tex.slice(0, 200),
              truncated: tex.length > 200,
              detail: `源码:\n${tex}`,
              hint: '已切换至离线兜底预览或 MathJax',
            },
          ],
        };
      }
      const escaped = tex.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      return {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 48" role="img" aria-label="LaTeX-Rust Preview"><text x="8" y="30" fill="currentColor" font-family="serif" font-size="18">${escaped}</text></svg>`,
        degraded: false,
        diagnostics: [],
      };
    },
    restoreBackup: async () => {
      recoveryActive = false;
      const clearRes = await dispatch({ SetRecoveryState: null });
      if (lastValidBackup) {
        userFormulas.splice(
          0,
          userFormulas.length,
          ...lastValidBackup.userFormulas.map((entry) => ({ ...entry, tags: [...entry.tags] })),
        );
        const restoredRes = await dispatch({ UpdateSettings: lastValidBackup.settings });
        return restoredRes.snapshot;
      }
      return clearRes.snapshot;
    },
    resetEmptyConfig: async () => {
      const current = await snapshot();
      const preservedPath = current.settings?.config_path ?? null;
      recoveryActive = false;
      userFormulas.length = 0;
      await dispatch({ SetRecoveryState: null });
      const res = await dispatch({
        UpdateSettings: { ...createDefaultAppSettings(), config_path: preservedPath },
      });
      return res.snapshot;
    },
    exportConfigJson: async () => {
      const snap = await snapshot();
      return JSON.stringify(
        {
          schema_version: 3,
          custom_formats: [],
          snippets: [],
          user_formulas: userFormulas,
          overrides: [],
          settings: snap.settings,
        },
        null,
        2,
      );
    },
    importConfigJson: async (rawJson: string) => {
      const parsedUnknown: unknown = JSON.parse(rawJson);
      if (
        typeof parsedUnknown !== 'object' ||
        parsedUnknown === null ||
        Array.isArray(parsedUnknown)
      ) {
        throw new Error('配置 JSON 根节点必须是对象');
      }
      const parsed = parsedUnknown as Record<string, unknown>;
      const ver = parsed.schema_version;
      if (typeof ver !== 'number' || !Number.isInteger(ver) || (ver !== 1 && ver !== 2 && ver !== 3)) {
        throw new Error(`不支持的 schema_version: ${String(ver)}`);
      }
      for (const arrayField of [
        'custom_formats',
        'customFormats',
        'snippets',
        'user_formulas',
        'formulas',
        'overrides',
      ]) {
        if (arrayField in parsed && !Array.isArray(parsed[arrayField])) {
          throw new Error(`${arrayField} 必须是数组`);
        }
      }

      const rawUserFormulas = Array.isArray(parsed.user_formulas) ? parsed.user_formulas : [];
      const rawSnippets = Array.isArray(parsed.snippets) ? parsed.snippets : [];
      const rawLegacyFormulas = Array.isArray(parsed.formulas) ? parsed.formulas : [];
      for (const item of [...rawUserFormulas, ...rawSnippets, ...rawLegacyFormulas]) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          const rec = item as Record<string, unknown>;
          if (rec.is_builtin === true || rec.isBuiltin === true) {
            throw new Error('禁止导入内置公式 (is_builtin: true)');
          }
        }
      }

      const importedEntries: FormulaEntryDto[] = [];
      const seenIds = new Set<string>();
      for (const item of [...rawUserFormulas, ...rawSnippets, ...rawLegacyFormulas]) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
        const rec = item as Record<string, unknown>;
        const formulaSource =
          typeof rec.source === 'string'
            ? rec.source
            : typeof rec.latex === 'string'
              ? rec.latex
              : '';
        if (!formulaSource.trim()) continue;
        const entryId =
          typeof rec.id === 'string' && rec.id.trim().length > 0
            ? rec.id.trim()
            : nextDesktopUniqueId('uf');
        if (seenIds.has(entryId)) continue;
        seenIds.add(entryId);
        importedEntries.push({
          id: entryId,
          name:
            typeof rec.name === 'string' && rec.name.trim().length > 0
              ? rec.name.trim()
              : `片段 ${formulaSource.slice(0, 18)}`,
          category:
            typeof rec.category === 'string' && rec.category.trim().length > 0
              ? rec.category.trim()
              : '自定义',
          source: formulaSource,
          desc: typeof rec.desc === 'string' ? rec.desc : '',
          tags: Array.isArray(rec.tags)
            ? rec.tags.filter((t): t is string => typeof t === 'string')
            : ['custom'],
          is_builtin: false,
          created_at:
            typeof rec.created_at === 'number' ? rec.created_at : Math.floor(Date.now() / 1000),
        });
      }

      recoveryActive = false;
      userFormulas.splice(0, userFormulas.length, ...importedEntries);

      if (typeof parsed.settings === 'object' && parsed.settings !== null && !Array.isArray(parsed.settings)) {
        const rawSettings = parsed.settings as Record<string, unknown>;
        const current = await snapshot();
        const baseSettings = current.settings ?? createDefaultAppSettings();
        const rawShortcuts = rawSettings.shortcuts;
        const nextSettings: AppSettings = {
          ...baseSettings,
          ...(rawSettings as Partial<AppSettings>),
          delimiter_style:
            typeof rawSettings.delimiter_style === 'string'
              ? (rawSettings.delimiter_style as AppSettings['delimiter_style'])
              : typeof rawSettings.delimiterStyle === 'string'
                ? (rawSettings.delimiterStyle as AppSettings['delimiter_style'])
                : baseSettings.delimiter_style,
          preview_scale_pct:
            typeof rawSettings.preview_scale_pct === 'number'
              ? rawSettings.preview_scale_pct
              : typeof rawSettings.previewScalePct === 'number'
                ? rawSettings.previewScalePct
                : baseSettings.preview_scale_pct,
          render_backend:
            typeof rawSettings.render_backend === 'string'
              ? (rawSettings.render_backend as AppSettings['render_backend'])
              : typeof rawSettings.renderBackend === 'string'
                ? (rawSettings.renderBackend as AppSettings['render_backend'])
                : baseSettings.render_backend,
          shortcuts: {
            ...baseSettings.shortcuts,
            ...(typeof rawShortcuts === 'object' && rawShortcuts !== null && !Array.isArray(rawShortcuts)
              ? (rawShortcuts as Partial<AppSettings['shortcuts']>)
              : {}),
          },
        };
        await dispatch({ UpdateSettings: nextSettings });
      }
      const res = await dispatch({ SetRecoveryState: null });
      return res.snapshot;
    },
    copyToClipboard: copyTextSafe,
    getUserFormulas: async () => [...userFormulas],
    saveUserFormula: async (name: string, category: string, formulaSource: string, desc: string) => {
      if (recoveryActive) {
        throw new Error('存在未解决的配置损坏恢复状态（recovery lock），请先从备份恢复或重置为空配置');
      }
      const entry: FormulaEntryDto = {
        id: nextDesktopUniqueId('uf'),
        name,
        category,
        source: formulaSource,
        desc,
        tags: ['custom'],
        is_builtin: false,
        created_at: Math.floor(Date.now() / 1000),
      };
      userFormulas.push(entry);
      const current = await snapshot();
      lastValidBackup = {
        settings: current.settings ?? createDefaultAppSettings(),
        userFormulas: userFormulas.map((item) => ({ ...item, tags: [...item.tags] })),
      };
      return entry;
    },
  };
}

export function createDesktopHostBridge(): DesktopHostBridge {
  const base = isTauriEnvironment() ? createTauriHostBridge() : createBrowserHarnessBridge();
  if (typeof window !== 'undefined' && window.__MATHSLOT_DESKTOP_BRIDGE__) {
    return {
      ...base,
      ...window.__MATHSLOT_DESKTOP_BRIDGE__,
    };
  }
  return base;
}
