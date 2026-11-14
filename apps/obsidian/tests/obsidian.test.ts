import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';

const obsidianMockState = vi.hoisted(() => ({
  processors: new Map<string, (source: string, el: HTMLElement, ctx: unknown) => void | Promise<void>>(),
  renderMathHandler: null as null | ((tex: string, display: boolean) => Promise<HTMLElement>),
}));

vi.mock('obsidian', async (importOriginal) => {
  const original = await importOriginal<typeof import('./mocks/obsidian')>();
  class PluginWithProcessors extends original.Plugin {
    override registerMarkdownCodeBlockProcessor(
      lang: string,
      handler: (source: string, el: HTMLElement, ctx: unknown) => void | Promise<void>,
    ): void {
      obsidianMockState.processors.set(lang, handler);
    }
    addSettingTab(_tab: unknown): void {}
  }
  class PluginSettingTab {
    app: unknown;
    plugin: unknown;
    containerEl = document.createElement('div');
    constructor(app: unknown, plugin: unknown) {
      this.app = app;
      this.plugin = plugin;
    }
    display(): void {}
  }
  class Setting {
    constructor(_el: HTMLElement) {}
    setName(): this {
      return this;
    }
    setDesc(): this {
      return this;
    }
    addButton(cb: (btn: { setButtonText: (t: string) => void; onClick: (fn: () => void) => void }) => void): this {
      cb({ setButtonText: () => {}, onClick: () => {} });
      return this;
    }
  }
  return {
    ...original,
    Plugin: PluginWithProcessors,
    PluginSettingTab,
    Setting,
    addIcon: () => {},
    renderMath: async (tex: string, display: boolean) => {
      if (obsidianMockState.renderMathHandler) {
        return obsidianMockState.renderMathHandler(tex, display);
      }
      return original.renderMath(tex, display);
    },
  };
});

import AppShell from '../src/AppShell.svelte';
import { createObsidianHostRenderAdapter } from '../src/hostRenderAdapter';
import MathSlotPlugin from '../src/plugin';
import {
  exportPluginConfigJson,
  importPluginConfigJson,
  loadAndValidateLibrary,
  readUserFormulas,
  resetEmptyLibrary,
  restoreFromBackup,
  saveUserSnippet,
  type PluginPersistedData,
} from '../src/storage';
import { EXPECTED_ENGINE_VERSION, WasmEngineClient } from '../src/wasmClient';

let mounted: ReturnType<typeof mount> | null = null;

function loadRealWasmBytes(): Uint8Array {
  const wasmPath = resolve(import.meta.dirname, '../src/wasm-pkg/mathslot_wasm_bg.wasm');
  return new Uint8Array(readFileSync(wasmPath));
}

afterEach(() => {
  if (mounted) {
    unmount(mounted);
    mounted = null;
  }
  obsidianMockState.renderMathHandler = null;
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('apps/obsidian WASM & shared UI integration (T3.6)', () => {
  it('INV-011: validates engineVersion() handshake and fails loudly on version mismatch', async () => {
    const wasmBytes = loadRealWasmBytes();

    const validClient = await WasmEngineClient.create({ wasmBytes });
    expect(await validClient.engineVersion()).toBe(EXPECTED_ENGINE_VERSION);
    const catalog = await validClient.catalog();
    expect(catalog.commands).toHaveLength(121);
    const presets = await validClient.presets();
    expect(presets.presets).toHaveLength(88);
    validClient.dispose();

    await expect(
      WasmEngineClient.create({
        wasmBytes,
        expectedVersion: '0.0.0-mismatch+schema99',
      }),
    ).rejects.toThrow(/version mismatch/i);
  });

  it('A-OBS-001: light theme mounts [data-host="obsidian"] with Obsidian CSS variable mapping and no hardcoded dark blocks', async () => {
    const wasmBytes = loadRealWasmBytes();
    const client = await WasmEngineClient.create({ wasmBytes });
    const tokensCss = readFileSync(
      resolve(import.meta.dirname, '../../../packages/ui/src/theme/tokens.css'),
      'utf8',
    );
    expect(tokensCss).toContain("[data-host='obsidian']");
    expect(tokensCss).toContain('--background-primary');
    expect(tokensCss).toContain('--text-normal');
    expect(tokensCss).toContain('--interactive-accent');

    const target = document.createElement('div');
    target.className = 'theme-light';
    document.body.appendChild(target);

    mounted = mount(AppShell, {
      target,
      props: {
        client,
        theme: 'light',
      },
    });
    await tick();
    await tick();

    const hostRoot = target.querySelector('[data-host="obsidian"]');
    expect(hostRoot).not.toBeNull();
    expect(hostRoot?.getAttribute('data-theme')).toBe('light');
    expect(hostRoot?.classList.contains('mathslot-obsidian-host')).toBe(true);

    const shellStyles = readFileSync(
      resolve(import.meta.dirname, '../src/AppShell.svelte'),
      'utf8',
    );
    expect(shellStyles).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(shellStyles).not.toMatch(/rgba\(/i);

    client.dispose();
  });

  it('A-OBS-002: corrupt libraryJson is quarantined in backupJson (never deleted) and drives SetRecoveryState + SettingsPanel wizard', async () => {
    const wasmBytes = loadRealWasmBytes();
    const client = await WasmEngineClient.create({ wasmBytes });

    const corruptPayload = '{"schema_version": 3, "customFormats": [ BROKEN';
    const data: PluginPersistedData = {
      libraryJson: corruptPayload,
      lastValidLibraryJson: '{"schema_version":3,"customFormats":[],"snippets":[]}',
    };
    const saveData = vi.fn(async (_next: PluginPersistedData) => {});

    const validation = await loadAndValidateLibrary(data, saveData);
    expect(validation.ok).toBe(false);
    expect(saveData).toHaveBeenCalled();
    expect(data.backupJson).toBeDefined();
    expect(data.backupJson?.length).toBeGreaterThanOrEqual(1);
    expect(data.backupJson?.[0]?.rawLibraryJson).toBe(corruptPayload);
    expect(validation.recovery).toBeDefined();

    // Dispatch SetRecoveryState to real WASM engine and mount AppShell
    if (validation.recovery) {
      await client.dispatch({ SetRecoveryState: validation.recovery });
    }

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(AppShell, {
      target,
      props: {
        client,
        initialSettingsOpen: true,
        onRestoreBackup: async () => {
          await restoreFromBackup(data, saveData);
          await client.dispatch({ SetRecoveryState: null });
        },
        onResetEmptyConfig: async () => {
          await resetEmptyLibrary(data, saveData);
          await client.dispatch({ SetRecoveryState: null });
        },
      },
    });
    await tick();
    await tick();

    const wizard = target.querySelector('[data-testid="recovery-wizard"]');
    expect(wizard).not.toBeNull();
    expect(wizard?.textContent).toContain(validation.recovery?.corrupt_path ?? '');

    // Trigger reset empty -> must preserve backupJson quarantine intact
    const resetTrigger = target.querySelector('[data-testid="recovery-reset-trigger"]') as HTMLButtonElement;
    resetTrigger.click();
    await tick();
    const resetConfirm = target.querySelector('[data-testid="recovery-reset-confirm"]') as HTMLButtonElement;
    resetConfirm.click();
    await new Promise((resolveFn) => setTimeout(resolveFn, 20));
    await tick();
    await tick();

    expect(data.backupJson?.[0]?.rawLibraryJson).toBe(corruptPayload);
    client.dispose();
  });

  it('A-OBS-003: mobile / narrow mode mounts usable editor, palette, presets, insert and copy controls', async () => {
    const wasmBytes = loadRealWasmBytes();
    const client = await WasmEngineClient.create({ wasmBytes });
    const onInsert = vi.fn();
    const onCopy = vi.fn();

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(AppShell, {
      target,
      props: {
        client,
        isMobile: true,
        onInsert,
        onCopy,
      },
    });
    await tick();
    await tick();

    const hostRoot = target.querySelector('[data-host="obsidian"]');
    expect(hostRoot?.classList.contains('is-mobile')).toBe(true);
    expect(target.querySelector('[data-testid="mathslot-editor"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="mathslot-palette"]')).not.toBeNull();

    await client.dispatch({ KeyInput: 'x' });
    await tick();

    const copyBtn = target.querySelector('[data-testid="obsidian-copy-btn"]') as HTMLButtonElement;
    const insertBtn = target.querySelector('[data-testid="obsidian-insert-btn"]') as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();
    expect(insertBtn).not.toBeNull();

    copyBtn.click();
    await new Promise((resolveFn) => setTimeout(resolveFn, 20));
    await tick();
    expect(onCopy).toHaveBeenCalledWith('x', 'x');

    insertBtn.click();
    await new Promise((resolveFn) => setTimeout(resolveFn, 20));
    await tick();
    expect(onInsert).toHaveBeenCalledWith('x', 'x');

    client.dispose();
  });

  it('A-OBS-004: all 88 presets including fixed D-126 presets are searchable and loadable in real WASM engine', async () => {
    const wasmBytes = loadRealWasmBytes();
    const client = await WasmEngineClient.create({ wasmBytes });

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(AppShell, {
      target,
      props: { client },
    });
    await tick();
    await tick();

    const presetsTab = target.querySelector('[data-palette-mode="presets"]') as HTMLButtonElement;
    presetsTab.click();
    await tick();

    const cards = target.querySelectorAll('.ms-preset-card');
    expect(cards).toHaveLength(88);

    // Search and load preset-044 (fixed D-126 gamma preset)
    const searchInput = target.querySelector('.ms-search-input') as HTMLInputElement;
    searchInput.value = '简谐阻尼振动';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    const filteredCards = target.querySelectorAll('.ms-preset-card');
    expect(filteredCards).toHaveLength(1);
    (filteredCards[0] as HTMLButtonElement).click();
    await tick();
    await tick();

    const snap = await client.snapshot();
    expect(snap.latex).toContain('\\gamma');
    expect(snap.latex).not.toContain('▸');

    client.dispose();
  });

  it('A-OBS-005: LaTeX import error diagnostic blocks document overwrite in WASM and ImportModal UI', async () => {
    const wasmBytes = loadRealWasmBytes();
    const client = await WasmEngineClient.create({ wasmBytes });

    await client.dispatch({ ImportLatex: '\\frac{a}{b}' });

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(AppShell, {
      target,
      props: { client },
    });
    await tick();
    await tick();

    const importBtn = target.querySelector('[data-testid="obsidian-import-btn"]') as HTMLButtonElement;
    importBtn.click();
    await tick();

    const textarea = target.querySelector('[data-testid="import-latex-input"]') as HTMLTextAreaElement;
    textarea.value = '{1 + 2';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    const submitBtn = target.querySelector('[data-testid="import-submit-btn"]') as HTMLButtonElement;
    submitBtn.click();
    await tick();
    await tick();

    expect(target.querySelector('[data-testid="import-blocked-banner"]')).not.toBeNull();
    const snap = await client.snapshot();
    expect(snap.latex).toBe('\\frac{a}{b}');
    expect(snap.last_import?.blocked).toBe(true);

    client.dispose();
  });

  it('OPEN-002: host renderMath adapter error degrades visibly with degraded badge and diagnostics', async () => {
    const renderer = createObsidianHostRenderAdapter({
      renderMath: async () => {
        throw new Error('Obsidian MathJax render crashed');
      },
      finishRenderMath: async () => {},
    });

    const out = await renderer.renderNow({
      generation: 1,
      latex: '\\frac{1}{2}',
      previewLatex: '\\frac{1}{2}',
      theme: 'light',
    });

    expect(out).not.toBeNull();
    expect(out?.degraded).toBe(true);
    expect(out?.diagnostics.length).toBeGreaterThan(0);
    expect(out?.errorSummary?.code).toBe('PRIMARY_RENDER_FAILED');
    expect(out?.svg).toContain('<svg');
  });

  it('A-OBS-001 / D-124: every --ms-* token referenced in apps/obsidian/src/styles.css and obsidian-mathslot/styles.css is defined in tokens.css', () => {
    const tokensCss = readFileSync(
      resolve(import.meta.dirname, '../../../packages/ui/src/theme/tokens.css'),
      'utf8',
    );
    const obsidianStyles = readFileSync(resolve(import.meta.dirname, '../src/styles.css'), 'utf8');
    const bundledStyles = readFileSync(
      resolve(import.meta.dirname, '../../../obsidian-mathslot/styles.css'),
      'utf8',
    );

    const definedTokens = new Set(
      Array.from(tokensCss.matchAll(/(--ms-[a-z0-9-]+)\s*:/g), (m) => m[1]),
    );

    // Every var(--ms-...) in apps/obsidian/src/styles.css must exist in tokens.css
    const obsidianRefs = Array.from(
      new Set(Array.from(obsidianStyles.matchAll(/var\((--ms-[a-z0-9-]+)/g), (m) => m[1])),
    ).sort();
    const missingInObsidian = obsidianRefs.filter((token) => !definedTokens.has(token));
    expect(missingInObsidian).toEqual([]);

    // Zero hardcoded hex or rgba() colors in apps/obsidian/src/styles.css
    expect(obsidianStyles).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(obsidianStyles).not.toMatch(/rgba?\(/i);

    // Every non-fallback var(--ms-...) in bundled obsidian-mathslot/styles.css must exist in tokens.css
    const bundledNoFallbackRefs = Array.from(
      new Set(Array.from(bundledStyles.matchAll(/var\((--ms-[a-z0-9-]+)\)/g), (m) => m[1])),
    ).sort();
    const missingInBundled = bundledNoFallbackRefs.filter((token) => !definedTokens.has(token));
    expect(missingInBundled).toEqual([]);
  });

  it('A-OBS-002 / D-122: clicking recovery-restore-btn ("从最近备份恢复") restores backed-up library intact and clears recovery', async () => {
    const wasmBytes = loadRealWasmBytes();
    const client = await WasmEngineClient.create({ wasmBytes });

    const backupPayload = JSON.stringify({
      schema_version: 3,
      customFormats: [{ id: 'fmt-1', name: 'BoldVec', template: '\\mathbf{?}', slotCount: 1 }],
      snippets: [{ id: 'snip-1', name: 'Quad', latex: 'x^2 + 1' }],
    });
    const corruptPayload = '{"schema_version": 3, "customFormats": [ CORRUPT';
    const data: PluginPersistedData = {
      libraryJson: corruptPayload,
      lastValidLibraryJson: backupPayload,
    };
    const saveData = vi.fn(async (_next: PluginPersistedData) => {});

    const validation = await loadAndValidateLibrary(data, saveData);
    expect(validation.ok).toBe(false);
    expect(validation.recovery).not.toBeNull();
    if (validation.recovery) {
      await client.dispatch({ SetRecoveryState: validation.recovery });
    }

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(AppShell, {
      target,
      props: {
        client,
        initialSettingsOpen: true,
        onRestoreBackup: async () => {
          await restoreFromBackup(data, saveData);
          await client.dispatch({ SetRecoveryState: null });
        },
        onResetEmptyConfig: async () => {
          await resetEmptyLibrary(data, saveData);
          await client.dispatch({ SetRecoveryState: null });
        },
      },
    });
    await tick();
    await tick();

    const restoreBtn = target.querySelector(
      '[data-testid="recovery-restore-btn"]',
    ) as HTMLButtonElement | null;
    expect(restoreBtn).not.toBeNull();
    expect(restoreBtn?.textContent).toContain('从最近备份恢复');
    expect(restoreBtn?.disabled).toBe(false);

    restoreBtn?.click();
    await new Promise((resolveFn) => setTimeout(resolveFn, 20));
    await tick();
    await tick();

    expect(data.libraryJson).toBe(backupPayload);
    expect(data.backupJson?.[0]?.rawLibraryJson).toBe(corruptPayload);
    const snapAfter = await client.snapshot();
    expect(snapAfter.recovery ?? null).toBeNull();
    expect(target.querySelector('[data-testid="recovery-wizard"]')).toBeNull();

    client.dispose();
  });

  it('D-121 / OPEN-002: codeblock processor detects dark theme and degrades visibly on <mjx-merror> or renderMath failure', async () => {
    obsidianMockState.processors.clear();
    const mockApp: import('obsidian').App = {
      workspace: {
        getActiveViewOfType: () => null,
      },
    };
    const plugin = new MathSlotPlugin(mockApp, {
      id: 'mathslot',
      name: 'MathSlot',
      version: '0.7.0',
    });
    await plugin.onload();

    const processor = obsidianMockState.processors.get('mathslot');
    expect(processor).toBeDefined();

    // 1) Dark theme detection + silent <mjx-merror> host render failure
    document.body.classList.add('theme-dark');
    obsidianMockState.renderMathHandler = async () => {
      const span = document.createElement('span');
      span.innerHTML =
        '<mjx-container><mjx-merror data-mjx-error="Undefined control sequence \\badcmd">\\badcmd</mjx-merror></mjx-container>';
      return span;
    };

    const elDarkMerror = document.createElement('div');
    await processor?.('\\badcmd', elDarkMerror, { addChild: () => {} });

    const wrapperDark = elDarkMerror.querySelector('.ms-obsidian-codeblock');
    expect(wrapperDark?.getAttribute('data-host')).toBe('obsidian');
    expect(wrapperDark?.getAttribute('data-theme')).toBe('dark');
    const badgeDark = elDarkMerror.querySelector('[data-mathslot-degraded="true"]');
    expect(badgeDark).not.toBeNull();
    expect(badgeDark?.classList.contains('ms-obsidian-degraded-badge')).toBe(true);
    expect(badgeDark?.textContent).toContain('降级预览');

    // 2) Thrown host renderMath error degrades cleanly with fallback SVG in dark theme
    obsidianMockState.renderMathHandler = async () => {
      throw new Error('Host renderMath unavailable');
    };
    const elDarkFallback = document.createElement('div');
    await processor?.('\\frac{a}{b}', elDarkFallback, { addChild: () => {} });
    const wrapperFallback = elDarkFallback.querySelector('.ms-obsidian-codeblock');
    expect(wrapperFallback?.getAttribute('data-theme')).toBe('dark');
    expect(elDarkFallback.querySelector('[data-mathslot-degraded="true"]')).not.toBeNull();
    expect(elDarkFallback.innerHTML).toContain('<svg');

    plugin.onunload();
  });

  it('D-132: saving SettingsPanel dark theme and resetting defaults immediately syncs live WasmEngineClient snapshot and root data-theme', async () => {
    const wasmBytes = loadRealWasmBytes();
    const client = await WasmEngineClient.create({ wasmBytes });
    const persistedCalls: unknown[] = [];

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(AppShell, {
      target,
      props: {
        client,
        initialSettingsOpen: true,
        onPersistSettings: async (next) => {
          persistedCalls.push(next);
        },
      },
    });
    await tick();
    await tick();

    const hostRoot = target.querySelector('[data-host="obsidian"]');
    expect(hostRoot?.getAttribute('data-theme')).toBe('light');

    // Switch theme to dark and save without closing modal
    const darkOption = target.querySelector('[data-testid="theme-option-dark"]') as HTMLButtonElement;
    darkOption.click();
    await tick();

    const saveBtn = target.querySelector('[data-testid="settings-save-btn"]') as HTMLButtonElement;
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 20));
    await tick();
    await tick();

    const snapAfterSave = await client.snapshot();
    expect(snapAfterSave.settings?.theme).toBe('dark');
    expect(hostRoot?.getAttribute('data-theme')).toBe('dark');
    expect(persistedCalls).toHaveLength(1);

    // Reset Defaults must also immediately sync runtime WasmEngineClient snapshot
    const resetTrigger = target.querySelector('[data-testid="settings-reset-trigger"]') as HTMLButtonElement;
    resetTrigger.click();
    await tick();
    const resetConfirm = target.querySelector('[data-testid="settings-reset-confirm"]') as HTMLButtonElement;
    resetConfirm.click();
    await new Promise((r) => setTimeout(r, 20));
    await tick();
    await tick();

    const snapAfterReset = await client.snapshot();
    expect(snapAfterReset.settings?.theme).toBe('system');
    expect(hostRoot?.getAttribute('data-theme')).toBe('light');
    expect(persistedCalls).toHaveLength(2);

    client.dispose();
  });

  it('D-133: ImportModal keeps round-trip report open on non-blocking import, SettingsPanel export triggers JSON download/hook, and PreviewPanel strict export blocks error/empty slots', async () => {
    const wasmBytes = loadRealWasmBytes();
    const client = await WasmEngineClient.create({ wasmBytes });
    const dispatchSpy = vi.spyOn(client, 'dispatch');
    const exportedPayloads: string[] = [];
    const onCopy = vi.fn();

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(AppShell, {
      target,
      props: {
        client,
        onCopy,
        onConfigExported: (rawJson: string) => {
          exportedPayloads.push(rawJson);
        },
      },
    });
    await tick();
    await tick();

    // 1) ImportModal non-blocking import must stay open showing round-trip report
    const importBtn = target.querySelector('[data-testid="obsidian-import-btn"]') as HTMLButtonElement;
    importBtn.click();
    await tick();

    const textarea = target.querySelector('[data-testid="import-latex-input"]') as HTMLTextAreaElement;
    textarea.value = '\\frac{1}{2}';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    const submitBtn = target.querySelector('[data-testid="import-submit-btn"]') as HTMLButtonElement;
    submitBtn.click();
    await new Promise((r) => setTimeout(r, 20));
    await tick();
    await tick();

    expect(target.querySelector('[data-testid="import-modal"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="import-report"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="import-roundtrip-latex"]')?.textContent).toContain(
      '\\frac{1}{2}',
    );

    // Close ImportModal manually
    (target.querySelector('[data-testid="import-close-btn"]') as HTMLButtonElement).click();
    await tick();
    expect(target.querySelector('[data-testid="import-modal"]')).toBeNull();

    // 2) SettingsPanel export config triggers JSON export hook/download
    (target.querySelector('[data-testid="obsidian-settings-btn"]') as HTMLButtonElement).click();
    await tick();
    (target.querySelector('[data-testid="settings-export-btn"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    await tick();

    expect(exportedPayloads).toHaveLength(1);
    const parsedExport = JSON.parse(exportedPayloads[0]!) as Record<string, unknown>;
    expect(parsedExport).toHaveProperty('settings');
    (target.querySelector('[data-testid="settings-close-btn"]') as HTMLButtonElement).click();
    await tick();

    // 3) PreviewPanel strict export dispatches RequestExport { strict: true } and blocks empty slots / errors
    await client.dispatch({ ApplyCard: 'frac' }); // \frac{}{} with empty slots
    await tick();
    await tick();

    const strictExportBtn = target.querySelector('[data-testid="preview-export-btn"]') as HTMLButtonElement | null;
    expect(strictExportBtn).not.toBeNull();
    strictExportBtn!.click();
    await new Promise((r) => setTimeout(r, 20));
    await tick();

    expect(dispatchSpy).toHaveBeenCalledWith({ RequestExport: { strict: true } });
    expect(onCopy).not.toHaveBeenCalled();
    expect(target.querySelector('.ms-obsidian-status')?.textContent).toContain('阻断');

    client.dispose();
  });

  it('D-134: PreviewPanel render failure forwards renderDiagnostics to DiagnosticsPanel and surfaces copy/view actions', async () => {
    const wasmBytes = loadRealWasmBytes();
    const client = await WasmEngineClient.create({ wasmBytes });
    await client.dispatch({ ImportLatex: '\\frac{1}{2}' });

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(AppShell, {
      target,
      props: {
        client,
        hostRenderMath: async () => {
          throw new Error('Simulated Obsidian renderMath crash');
        },
        hostFinishRenderMath: async () => {},
      },
    });

    await tick();
    await new Promise((r) => setTimeout(r, 60));
    await tick();
    await tick();

    expect(target.querySelector('[data-testid="degraded-badge"]')).not.toBeNull();
    const copyErrBtn = target.querySelector('[data-testid="preview-copy-error-btn"]') as HTMLButtonElement | null;
    const viewDiagBtn = target.querySelector('[data-testid="preview-view-diagnostics-btn"]') as HTMLButtonElement | null;
    expect(copyErrBtn).not.toBeNull();
    expect(viewDiagBtn).not.toBeNull();

    // DiagnosticsPanel receives renderDiagnostics synchronously
    const diagPanel = target.querySelector('[data-testid="mathslot-diagnostics"]');
    expect(diagPanel?.textContent).toContain('PRIMARY_RENDER_FAILED');
    const copyDiagBtn = target.querySelector('[data-testid="copy-diagnostics-btn"]') as HTMLButtonElement;
    expect(copyDiagBtn.disabled).toBe(false);

    // Clicking "查看诊断" expands DiagnosticsPanel drawer
    viewDiagBtn!.click();
    await tick();
    expect(target.querySelector('[data-testid="diagnostics-toggle"]')?.getAttribute('aria-expanded')).toBe('true');

    client.dispose();
  });

  it('D-135: SaveSnippet persists user_formulas to Obsidian PalettePanel and SettingsPanel enforces mathjax host constraint + preview_scale_pct', async () => {
    const wasmBytes = loadRealWasmBytes();
    const client = await WasmEngineClient.create({ wasmBytes });
    await client.dispatch({ LoadStreamSource: '▸f3;4;' });

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(AppShell, {
      target,
      props: { client },
    });
    await tick();
    await tick();

    // Save snippet
    (target.querySelector('[data-testid="obsidian-save-snippet-btn"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    await tick();

    // Switch PalettePanel to snippets tab and verify saved entry
    const snippetsTab = target.querySelector('[data-palette-mode="snippets"]') as HTMLButtonElement;
    expect(snippetsTab.textContent).toContain('片段 (1)');
    snippetsTab.click();
    await tick();

    const snippetCards = target.querySelectorAll('[data-snippet-card]');
    expect(snippetCards).toHaveLength(1);
    expect(snippetCards[0]?.textContent).toContain('\\frac{3}{4}');

    // Open SettingsPanel: latex-rust must be hidden and preview_scale_pct applies to PreviewPanel
    (target.querySelector('[data-testid="obsidian-settings-btn"]') as HTMLButtonElement).click();
    await tick();

    expect(target.querySelector('[data-testid="backend-option-mathjax"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="backend-option-latex-rust"]')).toBeNull();

    const scaleInput = target.querySelector('[data-testid="settings-preview-scale"]') as HTMLInputElement;
    scaleInput.value = '135';
    scaleInput.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    (target.querySelector('[data-testid="settings-save-btn"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    await tick();

    expect(target.querySelector('[data-testid="zoom-percent"]')?.textContent).toContain('135%');

    client.dispose();
  });

  it('D-148 / D-013 / D-014: Obsidian storage quarantines non-string/bad-version/corrupt payloads without destroying lastValidLibraryJson, blocks writes during recovery, generates collision-free IDs, and rejects is_builtin: true / malformed types on import', async () => {
    const validBackup = JSON.stringify({
      schema_version: 3,
      customFormats: [],
      snippets: [
        {
          id: '01933b4a-1111-7000-8000-000000000001',
          name: 'Saved Backup Formula',
          category: '自定义',
          source: 'a^2 + b^2 = c^2',
          desc: 'must never be destroyed',
          tags: ['safe'],
          is_builtin: false,
          created_at: 1700000000,
        },
      ],
    });

    // 1. Corrupt libraryJson -> quarantined + write-locked until restored/reset; saveUserSnippet MUST throw and MUST NOT overwrite lastValidLibraryJson
    const data: PluginPersistedData = {
      libraryJson: '{broken json',
      lastValidLibraryJson: validBackup,
    };
    const saveData = vi.fn(async (_next: PluginPersistedData) => {});

    const res1 = await loadAndValidateLibrary(data, saveData);
    expect(res1.ok).toBe(false);
    expect(res1.recovery?.backup_candidate).toBe('obsidian://plugin-data/lastValidLibraryJson');
    expect(data.lastValidLibraryJson).toBe(validBackup);

    // Repeating loadAndValidateLibrary with the same corrupt state must NOT spam duplicate entries into backupJson
    const backupCountAfterFirst = data.backupJson?.length ?? 0;
    const res2 = await loadAndValidateLibrary(data, saveData);
    expect(res2.ok).toBe(false);
    expect(data.backupJson?.length).toBe(backupCountAfterFirst);

    // Attempting saveUserSnippet while quarantined/corrupt MUST reject and preserve lastValidLibraryJson
    await expect(
      saveUserSnippet(data, saveData, '▸f1;2;', '\\frac{1}{2}'),
    ).rejects.toThrow(/恢复|损坏|quarantine|recovery/i);
    expect(data.lastValidLibraryJson).toBe(validBackup);

    // Non-string libraryJson must quarantine cleanly without throwing TypeError
    const nonStringData: PluginPersistedData = {
      libraryJson: 12345 as unknown as string,
      lastValidLibraryJson: validBackup,
    };
    const nonStrRes = await loadAndValidateLibrary(nonStringData, saveData);
    expect(nonStrRes.ok).toBe(false);
    expect(nonStrRes.recovery).not.toBeNull();
    expect(nonStringData.lastValidLibraryJson).toBe(validBackup);

    // Unknown schema_version (0, 99, -1, 1.5) must be quarantined on load
    for (const badVer of [0, 99, -1, 1.5]) {
      const verData: PluginPersistedData = {
        libraryJson: JSON.stringify({ schema_version: badVer, customFormats: [], snippets: [] }),
        lastValidLibraryJson: validBackup,
      };
      const verRes = await loadAndValidateLibrary(verData, saveData);
      expect(verRes.ok, `schema_version=${badVer} must fail validation`).toBe(false);
      expect(verRes.recovery).not.toBeNull();
    }

    // 2. importPluginConfigJson strict rejections (D-013, D-014, D-148)
    const cleanData: PluginPersistedData = {
      libraryJson: validBackup,
      lastValidLibraryJson: validBackup,
    };
    const rejectPayloads = [
      JSON.stringify({ customFormats: [], snippets: [] }), // missing schema_version
      JSON.stringify({ schema_version: 99, customFormats: [], snippets: [] }), // unknown schema_version
      JSON.stringify({ schema_version: 3, customFormats: 'bad', snippets: [] }), // non-array customFormats
      JSON.stringify({ schema_version: 3, customFormats: [], snippets: 'bad' }), // non-array snippets
      JSON.stringify({ schema_version: 3, libraryJson: '{broken embedded json' }), // corrupt embedded libraryJson
      JSON.stringify({
        schema_version: 3,
        customFormats: [],
        snippets: [{ id: 'x', name: 'Evil', source: 'x+1', is_builtin: true }],
      }), // is_builtin: true in snippets
      JSON.stringify({
        schema_version: 3,
        user_formulas: [{ id: 'x', name: 'Evil', source: 'x+1', is_builtin: true }],
      }), // is_builtin: true in user_formulas
    ];
    for (const payload of rejectPayloads) {
      await expect(
        importPluginConfigJson(payload, cleanData, saveData),
        `importPluginConfigJson must reject: ${payload}`,
      ).rejects.toThrow();
    }
    expect(cleanData.libraryJson).toBe(validBackup);

    // 3. Non-Date.now() collision-free IDs in saveUserSnippet (100 calls in tight loop)
    const burstData: PluginPersistedData = {
      libraryJson: JSON.stringify({ schema_version: 3, customFormats: [], snippets: [] }),
      lastValidLibraryJson: JSON.stringify({ schema_version: 3, customFormats: [], snippets: [] }),
    };
    for (let i = 0; i < 50; i += 1) {
      await saveUserSnippet(burstData, saveData, `x_${i}`, `x_${i}`);
    }
    const burstEntries = readUserFormulas(burstData);
    expect(burstEntries).toHaveLength(50);
    const uniqueIds = new Set(burstEntries.map((e) => e.id));
    expect(uniqueIds.size).toBe(50);
    for (const entry of burstEntries) {
      expect(entry.id).not.toMatch(/^snippet-\d+-\d+$/);
    }
  });

  it('D-147: AppShell & storage reject-before-mutate keeps persisted data intact and displays error without fake saved feedback', async () => {
    const wasmBytes = loadRealWasmBytes();
    const client = await WasmEngineClient.create({ wasmBytes });

    const initialBackup = JSON.stringify({
      schema_version: 3,
      customFormats: [],
      snippets: [
        {
          id: '01933b4a-1111-7000-8000-000000000001',
          name: 'Original Formula',
          category: '自定义',
          source: 'a+b',
          desc: '',
          tags: [],
          is_builtin: false,
        },
      ],
    });
    const data: PluginPersistedData = {
      libraryJson: initialBackup,
      lastValidLibraryJson: initialBackup,
    };
    const failingSaveData = vi.fn(async (_next: PluginPersistedData) => {
      throw new Error('EACCES: permission denied');
    });

    // storage.saveUserSnippet must NOT mutate `data` when saveData rejects
    await expect(
      saveUserSnippet(data, failingSaveData, '▸f1;2;', '\\frac{1}{2}'),
    ).rejects.toThrow(/EACCES/);
    expect(data.libraryJson).toBe(initialBackup);
    expect(data.lastValidLibraryJson).toBe(initialBackup);
    expect(readUserFormulas(data)).toHaveLength(1);

    // AppShell must catch save/snippet/restore/reset failures, show error banner/status, and NOT show "设置已应用"
    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(AppShell, {
      target,
      props: {
        client,
        initialSettingsOpen: true,
        initialUserFormulas: readUserFormulas(data),
        onPersistSettings: async () => {
          throw new Error('Disk full (ENOSPC)');
        },
        onSaveSnippet: async () => {
          throw new Error('Recovery lock active');
        },
      },
    });
    await tick();
    await tick();

    // Mutate theme and click Save -> must NOT show "设置已应用" and must surface error
    (target.querySelector('[data-testid="theme-option-dark"]') as HTMLButtonElement).click();
    await tick();
    (target.querySelector('[data-testid="settings-save-btn"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 30));
    await tick();

    expect(target.textContent).not.toContain('设置已应用');
    expect(target.querySelector('[data-testid="settings-save-error"]')?.textContent).toContain(
      'ENOSPC',
    );
    expect(target.querySelector('.ms-obsidian-status')?.textContent).toContain('ENOSPC');

    // Click Save Snippet -> must show error in status without mutating userFormulas
    await client.dispatch({ LoadStreamSource: '▸f9;9;' });
    await tick();
    (target.querySelector('[data-testid="obsidian-save-snippet-btn"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 30));
    await tick();
    expect(target.querySelector('.ms-obsidian-status')?.textContent).toContain('Recovery lock');
    expect(target.querySelector('[data-palette-mode="snippets"]')?.textContent).toContain('片段 (1)');

    client.dispose();
  });

  it('D-149 / D-148: Obsidian importPluginConfigJson losslessly imports Desktop LibraryFile JSON and AppShell auto-opens/refreshes recovery', async () => {
    const desktopExported = JSON.stringify({
      schema_version: 3,
      custom_formats: [
        {
          key: 'q',
          label: '向量格式',
          glyph: 'v',
          roles: ['arg'],
          latex: '\\vec{$1}',
          schemeA: 'vec',
        },
      ],
      snippets: [],
      user_formulas: [
        {
          id: '01933b4a-2222-7000-8000-000000000002',
          name: 'Desktop 导出的公式',
          category: '物理',
          source: 'E = m c^2',
          desc: '来自桌面端',
          tags: ['physics'],
          created_at: 1700000200,
        },
      ],
      overrides: [{ preset_id: 'preset-euler-identity', hidden: false, name: '我的欧拉' }],
      settings: {
        theme: 'dark',
        delimiter_style: 'block_dollar',
        render_backend: 'latex-rust',
        preview_scale_pct: 140,
      },
    });

    const data: PluginPersistedData = {};
    const saveData = vi.fn(async (_next: PluginPersistedData) => {});
    const imported = await importPluginConfigJson(desktopExported, data, saveData);
    expect(imported.userFormulas).toHaveLength(1);
    expect(imported.userFormulas[0]?.name).toBe('Desktop 导出的公式');
    expect(imported.userFormulas[0]?.source).toBe('E = m c^2');
    expect(imported.settings?.theme).toBe('dark');
    expect(imported.settings?.preview_scale_pct).toBe(140);

    const parsedLib = JSON.parse(imported.libraryJson) as Record<string, unknown>;
    expect(Array.isArray(parsedLib.customFormats)).toBe(true);
    expect((parsedLib.customFormats as unknown[]).length).toBe(1);
    expect(Array.isArray(parsedLib.overrides)).toBe(true);
    expect((parsedLib.overrides as unknown[]).length).toBe(1);

    // Exported JSON also exposes Desktop-compatible fields
    const reExported = JSON.parse(exportPluginConfigJson(data, imported.settings)) as Record<
      string,
      unknown
    >;
    expect(Array.isArray(reExported.user_formulas)).toBe(true);
    expect((reExported.user_formulas as unknown[]).length).toBe(1);
    expect(Array.isArray(reExported.custom_formats)).toBe(true);
    expect((reExported.custom_formats as unknown[]).length).toBe(1);

    // AppShell auto-opens settings when client has active recovery & refreshes userFormulas on restore
    const wasmBytes = loadRealWasmBytes();
    const client = await WasmEngineClient.create({ wasmBytes });
    await client.dispatch({
      SetRecoveryState: {
        corrupt_path: 'obsidian://plugin-data/backupJson/corrupt-1',
        backup_candidate: 'obsidian://plugin-data/lastValidLibraryJson',
        error: 'unexpected token',
      },
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(AppShell, {
      target,
      props: {
        client,
        initialUserFormulas: [],
        onRestoreBackup: async () => {
          await client.dispatch({ SetRecoveryState: null });
          return imported.userFormulas;
        },
      },
    });
    await new Promise((r) => setTimeout(r, 30));
    await tick();

    // Recovery wizard should auto-open without clicking settings button
    expect(target.querySelector('[data-testid="recovery-wizard"]')).not.toBeNull();
    (target.querySelector('[data-testid="recovery-restore-btn"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 30));
    await tick();

    expect(target.querySelector('[data-testid="recovery-wizard"]')).toBeNull();
    expect(target.querySelector('[data-palette-mode="snippets"]')?.textContent).toContain('片段 (1)');

    client.dispose();
  });

  it('D-152 / D-153: mathslot_wasm_bg.wasm <= 400 KB, main.js embeds WASM once, and hostRenderAdapter maxWait < 100ms', async () => {
    const wasmPath = resolve(import.meta.dirname, '../src/wasm-pkg/mathslot_wasm_bg.wasm');
    const wasmBytes = readFileSync(wasmPath);
    expect(wasmBytes.byteLength).toBeLessThanOrEqual(409_600);

    const mainJsPath = resolve(import.meta.dirname, '../../../obsidian-mathslot/main.js');
    const mainJs = readFileSync(mainJsPath, 'utf8');
    const embeddedWasmChunks = mainJs.match(/AGFzbQE[A-Za-z0-9+/=]{100,}/g) ?? [];
    expect(embeddedWasmChunks).toHaveLength(1);

    const renderer = createObsidianHostRenderAdapter({
      renderMath: async (tex) => `<svg data-tex="${tex}"></svg>`,
      finishRenderMath: async () => {},
    });
    const deliveredAt: number[] = [];
    const startMs = performance.now();
    for (let i = 1; i <= 10; i += 1) {
      renderer.schedule({ generation: i, latex: `y+${i}`, theme: 'light' }, () => {
        deliveredAt.push(performance.now() - startMs);
      });
      if (i < 10) {
        await new Promise((r) => setTimeout(r, 15));
      }
    }
    await new Promise((r) => setTimeout(r, 60));
    renderer.dispose();

    expect(deliveredAt.length).toBeGreaterThanOrEqual(1);
    expect(deliveredAt.length).toBeLessThan(10);
    expect(deliveredAt[0]).toBeLessThan(100);
  });

  it('T4.4 / D-156..D-160: AppShell hides file input from Tab order, uses h1, mounts permanent live region with error severity, wraps SettingsPanel in dialog with focus restore, and runs ImportAcknowledge on Escape', async () => {
    const wasmBytes = loadRealWasmBytes();
    const client = await WasmEngineClient.create({ wasmBytes });
    const dispatchSpy = vi.spyOn(client, 'dispatch');

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(AppShell, {
      target,
      props: { client },
    });
    await tick();
    await tick();

    // D-160: h1 heading & permanent live status region
    const h1 = target.querySelector('h1.ms-obsidian-title');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toBe('MathSlot');

    const statusEl = target.querySelector<HTMLElement>('.ms-obsidian-status');
    expect(statusEl).not.toBeNull();
    expect(statusEl!.getAttribute('role')).toBe('status');
    expect(statusEl!.getAttribute('aria-live')).toBe('polite');
    expect(statusEl!.getAttribute('aria-atomic')).toBe('true');

    // D-157: hidden file input excluded from Tab order
    const fileInput = target.querySelector<HTMLInputElement>(
      '[data-testid="obsidian-config-file-input"]',
    );
    expect(fileInput).not.toBeNull();
    expect(fileInput!.tabIndex).toBe(-1);
    expect(fileInput!.getAttribute('aria-hidden')).toBe('true');

    // D-159: .ms-obsidian-btn has :focus-visible ring in styles.css
    const obsidianCss = readFileSync(resolve(import.meta.dirname, '../src/styles.css'), 'utf8');
    expect(obsidianCss).toContain('.ms-obsidian-btn:focus-visible');

    // D-156: SettingsPanel wrapped in role="dialog" aria-modal="true" + focus entry + focus restore
    const settingsBtn = target.querySelector<HTMLButtonElement>(
      '[data-testid="obsidian-settings-btn"]',
    )!;
    settingsBtn.focus();
    settingsBtn.click();
    await tick();
    await tick();

    const settingsDialog = target.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    expect(settingsDialog).not.toBeNull();
    expect(settingsDialog!.querySelector('[data-testid="settings-panel"]')).not.toBeNull();
    expect(settingsDialog!.contains(document.activeElement)).toBe(true);

    target.querySelector<HTMLButtonElement>('[data-testid="settings-close-btn"]')!.click();
    await tick();
    await tick();
    expect(target.querySelector('[data-testid="settings-panel"]')).toBeNull();
    expect(document.activeElement).toBe(settingsBtn);

    // D-156: ImportModal Escape runs ImportAcknowledge and restores focus
    const importBtn = target.querySelector<HTMLButtonElement>('[data-testid="obsidian-import-btn"]')!;
    importBtn.focus();
    importBtn.click();
    await tick();
    await tick();

    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="import-latex-input"]')!;
    textarea.value = 'x^2';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    target.querySelector<HTMLButtonElement>('[data-testid="import-submit-btn"]')!.click();
    await new Promise((r) => setTimeout(r, 20));
    await tick();

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 20));
    await tick();

    expect(target.querySelector('[data-testid="import-modal"]')).toBeNull();
    expect(dispatchSpy.mock.calls.some((c) => c[0] === 'ImportAcknowledge')).toBe(true);
    expect(document.activeElement).toBe(importBtn);

    // D-160: strict export block sets error severity on status region
    await client.dispatch({ ApplyCard: 'frac' });
    await tick();
    target.querySelector<HTMLButtonElement>('[data-testid="preview-export-btn"]')!.click();
    await new Promise((r) => setTimeout(r, 20));
    await tick();
    expect(statusEl!.getAttribute('data-severity')).toBe('Error');

    client.dispose();
  });
});
