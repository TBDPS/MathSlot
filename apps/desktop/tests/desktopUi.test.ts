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
});
