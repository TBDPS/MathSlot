import { describe, expect, it } from 'vitest';

const fsMod = 'node:fs';
const pathMod = 'node:path';
const fs = (await import(/* @vite-ignore */ fsMod)) as {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: 'utf8') => string;
};
const path = (await import(/* @vite-ignore */ pathMod)) as {
  resolve: (...segments: string[]) => string;
};

interface ParityItem {
  id: string;
  name: string;
  status: 'aligned' | 'intentional_diff' | string;
  desktopEvidence: string;
  obsidianEvidence: string;
  reason?: string;
}

interface ParityCategory {
  id: string;
  name: string;
  items: ParityItem[];
}

interface ParityManifest {
  schema_version: number;
  gate: string;
  task: string;
  platforms: string[];
  categories: ParityCategory[];
}

const META_DIR = (import.meta as ImportMeta & { dirname?: string }).dirname ?? '.';
const REPO_ROOT = path.resolve(META_DIR, '../../..');

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relPath), 'utf8');
}

describe('Desktop vs Obsidian Feature Parity Contract (T3.7 / D-131..D-136)', () => {
  it('feature-parity.json covers all 7 AUD-27 categories with zero unregistered gaps', () => {
    const manifest = JSON.parse(readRepoFile('packages/ui/feature-parity.json')) as ParityManifest;

    expect(manifest.schema_version).toBe(1);
    expect(manifest.task).toBe('T3.7');
    expect(manifest.platforms).toEqual(['desktop', 'obsidian']);
    expect(manifest.categories.map((c) => c.id)).toEqual([
      'core_engine_catalog',
      'editor_interaction',
      'palette_nav_responsive',
      'preview_and_diagnostics',
      'settings_persistence_recovery',
      'latex_import',
      'obsidian_host_and_e2e',
    ]);

    const seenIds = new Set<string>();
    for (const category of manifest.categories) {
      expect(category.items.length).toBeGreaterThan(0);
      for (const item of category.items) {
        expect(seenIds.has(item.id)).toBe(false);
        seenIds.add(item.id);
        expect(['aligned', 'intentional_diff']).toContain(item.status);
        expect(item.desktopEvidence.trim().length).toBeGreaterThan(0);
        expect(item.obsidianEvidence.trim().length).toBeGreaterThan(0);
        if (item.status === 'intentional_diff') {
          expect(typeof item.reason).toBe('string');
          expect((item.reason ?? '').trim().length).toBeGreaterThan(10);
        }
      }
    }
  });

  it('Desktop App.svelte and Obsidian AppShell.svelte both wire renderDiagnostics, preview_scale_pct, strict export, userFormulas, and live settings sync', () => {
    const desktopApp = readRepoFile('apps/desktop/src/App.svelte');
    const obsidianShell = readRepoFile('apps/obsidian/src/AppShell.svelte');

    // D-134: PreviewPanel.onRenderResult -> DiagnosticsPanel.renderDiagnostics
    for (const src of [desktopApp, obsidianShell]) {
      expect(src).toContain('onRenderResult');
      expect(src).toContain('renderDiagnostics');
      expect(src).toContain('RequestExport');
      expect(src).toContain('onExportLatex');
      expect(src).toContain('preview_scale_pct');
      expect(src).toContain('userFormulas');
      expect(src).toContain('UpdateSettings');
      expect(src).toContain('ResetSettingsConfirmed');
      expect(src).toContain('<svelte:window onkeydown=');
    }

    // D-132 / D-133 / D-135 Obsidian AppShell parity checks
    expect(obsidianShell).toContain('onImportConfig');
    expect(obsidianShell).toContain('onExportConfig');
    expect(obsidianShell).toContain('onFocusEditor');
    expect(obsidianShell).toContain('onSaveSnippet');
    expect(obsidianShell).toContain('RequestSaveSnippet');
    expect(obsidianShell).toContain('supportedBackends');
    expect(obsidianShell).not.toMatch(/if\s*\(res\.snapshot\.last_import\s*&&\s*!res\.snapshot\.last_import\.blocked\)\s*\{\s*importOpen\s*=\s*false/);
  });

  it('Shared UI components expose parity controls (PreviewPanel, SettingsPanel, PalettePanel)', () => {
    const previewPanel = readRepoFile('packages/ui/src/preview/PreviewPanel.svelte');
    const settingsPanel = readRepoFile('packages/ui/src/settings/SettingsPanel.svelte');
    const palettePanel = readRepoFile('packages/ui/src/palette/PalettePanel.svelte');

    expect(previewPanel).toContain('previewScalePct');
    expect(previewPanel).toContain('onViewDiagnostics');
    expect(previewPanel).toContain('preview-copy-error-btn');
    expect(previewPanel).toContain('preview-view-diagnostics-btn');

    expect(settingsPanel).toContain('supportedBackends');
    expect(settingsPanel).toContain('preview_scale_pct');
    expect(settingsPanel).toContain('settings-preview-scale');

    expect(palettePanel).toContain('userFormulas');
    expect(palettePanel).toContain('data-palette-mode="snippets"');
  });

  it('D-131: bundled obsidian-mathslot/main.js includes latest editor sync, strict export, snippet, and settings parity symbols', () => {
    const keymapTs = readRepoFile('packages/ui/src/editor/keymap.ts');
    const editorSvelte = readRepoFile('packages/ui/src/editor/MathSlotEditor.svelte');
    expect(keymapTs).toContain('lastKeydownInputChar');
    expect(editorSvelte).toContain('externalSyncAnnotation');

    const mainJsPath = path.resolve(REPO_ROOT, 'obsidian-mathslot/main.js');
    expect(fs.existsSync(mainJsPath)).toBe(true);
    const mainJs = fs.readFileSync(mainJsPath, 'utf8');

    const requiredBundleSymbols = [
      'beforeinput',
      'insertText',
      'KeyDown',
      'RequestSaveSnippet',
      'RequestExport',
      'UpdateSettings',
      'ResetSettingsConfirmed',
      'preview_scale_pct',
      'supportedBackends',
      'renderDiagnostics',
      'preview-copy-error-btn',
      'preview-view-diagnostics-btn',
      'settings-preview-scale',
      'obsidian-save-snippet-btn',
      'obsidian-config-file-input',
    ];
    for (const sym of requiredBundleSymbols) {
      expect(mainJs, `obsidian-mathslot/main.js missing symbol "${sym}"`).toContain(sym);
    }
  });
});
