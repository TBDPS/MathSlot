import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import AppShell from '../src/AppShell.svelte';
import { createObsidianHostRenderAdapter } from '../src/hostRenderAdapter';
import {
  loadAndValidateLibrary,
  resetEmptyLibrary,
  restoreFromBackup,
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
});
