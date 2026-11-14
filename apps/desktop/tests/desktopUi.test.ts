import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import App from '../src/App.svelte';
import {
  createBrowserHarnessBridge,
  type DesktopHostBridge,
} from '../src/lib/desktopClient';

describe('apps/desktop UI & DesktopHostBridge (T3.5)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    document.body.innerHTML = '';
  });

  it('S-006 / A-UI-004: contains zero hardcoded hex or rgba colors inside App.svelte', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../src/App.svelte'), 'utf8');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(src).not.toMatch(/rgba\s*\(/i);
  });

  it('mounts desktop workspace, applies cards/presets, saves snippet, and switches Light/Dark themes', async () => {
    const bridge = createBrowserHarnessBridge();
    const copySpy = vi.spyOn(bridge, 'copyToClipboard');
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(App, {
      target,
      props: { bridge },
    });
    cleanups.push(() => {
      void unmount(app);
    });

    await tick();
    await new Promise((r) => setTimeout(r, 20));
    await tick();

    const shell = target.querySelector('[data-testid="desktop-app"]');
    expect(shell).not.toBeNull();
    expect(shell?.getAttribute('data-host')).toBe('desktop');
    expect(shell?.getAttribute('data-theme')).toBe('light');

    // Verify D-001 featured card exists and click Fraction card in PalettePanel grid
    expect(target.querySelector('[data-featured-card="partial"]')).not.toBeNull();
    const fracCard = target.querySelector<HTMLButtonElement>('[data-command-card="frac"]');
    expect(fracCard).not.toBeNull();
    fracCard!.click();
    await tick();
    await new Promise((r) => setTimeout(r, 20));
    await tick();

    const copyPreview = target.querySelector('[data-testid="desktop-copy-preview"]');
    expect(copyPreview?.textContent).toContain('\\frac{}{}');

    // Copy LaTeX
    target.querySelector<HTMLButtonElement>('[data-testid="desktop-copy-btn"]')?.click();
    await tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(copySpy).toHaveBeenCalled();

    // Save snippet
    target.querySelector<HTMLButtonElement>('[data-testid="desktop-save-snippet-btn"]')?.click();
    await tick();
    await new Promise((r) => setTimeout(r, 20));
    const formulas = await bridge.getUserFormulas();
    expect(formulas).toHaveLength(1);

    // Open Settings and switch to Dark theme + inline_dollar delimiter (single dispatch, no double-fire)
    const dispatchSpy = vi.spyOn(bridge, 'dispatch');
    target.querySelector<HTMLButtonElement>('[data-testid="desktop-settings-btn"]')?.click();
    await tick();

    target.querySelector<HTMLButtonElement>('[data-testid="theme-option-dark"]')?.click();
    target
      .querySelector<HTMLButtonElement>('[data-testid="delimiter-option-inline_dollar"]')
      ?.click();
    await tick();

    const callsBeforeSave = dispatchSpy.mock.calls.length;
    target.querySelector<HTMLButtonElement>('[data-testid="settings-save-btn"]')?.click();
    await tick();
    await new Promise((r) => setTimeout(r, 20));
    await tick();

    expect(dispatchSpy.mock.calls.length - callsBeforeSave).toBe(1);
    expect(shell?.getAttribute('data-theme')).toBe('dark');
    expect(target.querySelector('[data-testid="desktop-copy-preview"]')?.textContent).toContain(
      '$\\frac{}{}$',
    );
  });

  it('auto-opens recovery wizard when startup snapshot carries corrupt recovery state and restores cleanly', async () => {
    const base = createBrowserHarnessBridge();
    await base.dispatch({
      SetRecoveryState: {
        corrupt_path: '/tmp/library.corrupt-1.json',
        backup_candidate: '/tmp/library.bak-1.json',
        error: 'unexpected EOF',
      },
    });
    const restoreSpy = vi.spyOn(base, 'restoreBackup');

    const bridge: DesktopHostBridge = base;
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(App, {
      target,
      props: { bridge },
    });
    cleanups.push(() => {
      void unmount(app);
    });

    await new Promise((r) => setTimeout(r, 30));
    await tick();

    const wizard = target.querySelector('[data-testid="recovery-wizard"]');
    expect(wizard).not.toBeNull();
    expect(wizard?.textContent).toContain('/tmp/library.corrupt-1.json');

    target.querySelector<HTMLButtonElement>('[data-testid="recovery-restore-btn"]')?.click();
    await new Promise((r) => setTimeout(r, 30));
    await tick();

    expect(restoreSpy).toHaveBeenCalledWith('/tmp/library.bak-1.json');
    expect(target.querySelector('[data-testid="recovery-wizard"]')).toBeNull();
  });

  it('D-143 / D-137: browser harness uses real Rust/WASM engine semantics for LaTeX import (no brace-counting fake)', async () => {
    const bridge = createBrowserHarnessBridge();

    // 1. Unknown macro must yield lossless=false, raw_nodes=1, UNKNOWN_MACRO Warning
    const macroRes = await bridge.dispatch({ ImportLatex: '\\unknownFallbackTest{x}' });
    expect(macroRes.snapshot.last_import?.blocked).toBe(false);
    expect(macroRes.snapshot.last_import?.lossless).toBe(false);
    expect(macroRes.snapshot.last_import?.raw_nodes).toBe(1);
    expect(macroRes.snapshot.last_import?.diagnostics.some((d) => d.code === 'UNKNOWN_MACRO')).toBe(
      true,
    );

    // 2. Unsupported align environment must degrade to RawLatex with Warning (D-138)
    const alignRes = await bridge.dispatch({
      ImportLatex: '\\begin{align} a &= b \\\\ c &= d \\end{align}',
    });
    expect(alignRes.snapshot.last_import?.blocked).toBe(false);
    expect(alignRes.snapshot.last_import?.lossless).toBe(false);
    expect(alignRes.snapshot.last_import?.raw_nodes).toBe(1);

    // 3. PreviewImportLatex + outer delimiters $$...$$ stripped cleanly (D-140 / D-142)
    const beforePreview = await bridge.snapshot();
    const previewRes = await bridge.dispatch({ PreviewImportLatex: '$$\\frac{1}{2}$$' });
    expect(previewRes.snapshot.latex).toBe(beforePreview.latex);
    expect(previewRes.snapshot.last_import?.blocked).toBe(false);
    expect(previewRes.snapshot.last_import?.roundtrip_latex).toBe('\\frac{1}{2}');
    expect(
      previewRes.snapshot.last_import?.diagnostics.some((d) => d.code === 'OUTER_DELIMITERS_STRIPPED'),
    ).toBe(true);

    const delimRes = await bridge.dispatch({ ImportLatex: '$$\\frac{1}{2}$$' });
    expect(delimRes.snapshot.last_import?.blocked).toBe(false);
    expect(delimRes.snapshot.last_import?.roundtrip_latex).toBe('\\frac{1}{2}');
    expect(delimRes.snapshot.latex).toBe('\\frac{1}{2}');

    // 4. 5000-level deep nesting & stray } must block with Error without crashing (D-141 / D-139)
    const strayRes = await bridge.dispatch({ ImportLatex: '1 + 2}' });
    expect(strayRes.snapshot.last_import?.blocked).toBe(true);
    expect(strayRes.snapshot.latex).toBe('\\frac{1}{2}');
    const deep = `${'{'.repeat(5000)}x${'}'.repeat(5000)}`;
    const deepRes = await bridge.dispatch({ ImportLatex: deep });
    expect(deepRes.snapshot.last_import?.blocked).toBe(true);
    expect(deepRes.snapshot.latex).toBe('\\frac{1}{2}');
  });
});
