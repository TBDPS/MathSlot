import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';

const fsMod = 'node:fs';
const pathMod = 'node:path';
const fs = (await import(/* @vite-ignore */ fsMod)) as {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: 'utf8') => string;
};
const path = (await import(/* @vite-ignore */ pathMod)) as {
  resolve: (...segments: string[]) => string;
};

function readUiSource(relFromUiRoot: string): string {
  const localPath = path.resolve(relFromUiRoot);
  if (fs.existsSync(localPath)) {
    return fs.readFileSync(localPath, 'utf8');
  }
  return fs.readFileSync(path.resolve('packages/ui', relFromUiRoot), 'utf8');
}
import ImportModal from '../src/import/ImportModal.svelte';
import MathSlotEditor from '../src/editor/MathSlotEditor.svelte';
import PalettePanel from '../src/palette/PalettePanel.svelte';
import SettingsPanel from '../src/settings/SettingsPanel.svelte';
import {
  createDefaultAppSettings,
  createEmptySnapshot,
  type AppEvent,
  type DispatchResponse,
  type EngineClient,
  type RecoveryStateSnapshot,
} from '../src/client/engine';

function createMockClient(): {
  client: EngineClient;
  events: AppEvent[];
} {
  const events: AppEvent[] = [];
  const client: EngineClient = {
    dispatch: vi.fn(async (event: AppEvent): Promise<DispatchResponse> => {
      events.push(event);
      const snap = createEmptySnapshot();
      if (typeof event === 'object' && event !== null && 'PreviewImportLatex' in event) {
        snap.last_import = {
          input_latex: event.PreviewImportLatex,
          lossless: true,
          empty_slots: 0,
          raw_nodes: 0,
          roundtrip_latex: event.PreviewImportLatex,
          normalized_match: true,
          blocked: false,
          diagnostics: [],
        };
      }
      return { effects: [], snapshot: snap };
    }),
    snapshot: vi.fn(async () => createEmptySnapshot()),
    engineVersion: vi.fn(async () => '0.7.0-test'),
  };
  return { client, events };
}

describe('T4.4 / A-UI-001 shared UI accessibility regressions (D-156, D-158..D-160)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    document.body.innerHTML = '';
  });

  it('D-156: ImportModal moves focus inside dialog on open, traps Tab/Shift+Tab, and Escape triggers ImportAcknowledge via handleCancel', async () => {
    const { client, events } = createMockClient();
    const onClose = vi.fn();
    const wrapper = document.createElement('div');
    const outsideTrigger = document.createElement('button');
    outsideTrigger.textContent = 'Open Import';
    const modalHost = document.createElement('div');
    wrapper.append(outsideTrigger, modalHost);
    document.body.appendChild(wrapper);

    outsideTrigger.focus();
    expect(document.activeElement).toBe(outsideTrigger);

    const app = mount(ImportModal, {
      target: modalHost,
      props: {
        open: true,
        client,
        initialLatex: 'x^2',
        onClose,
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();
    await tick();

    const modalEl = modalHost.querySelector<HTMLElement>('[data-testid="import-modal"]');
    expect(modalEl).not.toBeNull();
    expect(modalEl!.contains(document.activeElement)).toBe(true);

    // Trigger preview so activeReport is populated
    const submitBtn = modalHost.querySelector<HTMLButtonElement>('[data-testid="import-submit-btn"]')!;
    submitBtn.click();
    await tick();
    await tick();

    // Shift+Tab from first focusable element must wrap to last focusable element inside modal
    const closeBtn = modalHost.querySelector<HTMLButtonElement>('[data-testid="import-close-btn"]')!;
    closeBtn.focus();
    const shiftTabEvt = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    closeBtn.dispatchEvent(shiftTabEvt);
    expect(shiftTabEvt.defaultPrevented).toBe(true);
    expect(modalEl!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(outsideTrigger);

    // Tab from last focusable element (ack btn) must wrap back inside modal
    const ackBtn = modalHost.querySelector<HTMLButtonElement>('[data-testid="import-ack-btn"]')!;
    ackBtn.focus();
    const tabEvt = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    ackBtn.dispatchEvent(tabEvt);
    expect(tabEvt.defaultPrevented).toBe(true);
    expect(modalEl!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(closeBtn);

    // Escape inside ImportModal must dispatch ImportAcknowledge via handleCancel() and call onClose
    const escEvt = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    modalEl!.dispatchEvent(escEvt);
    await tick();
    expect(escEvt.defaultPrevented).toBe(true);
    expect(events).toContain('ImportAcknowledge');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('D-156: SettingsPanel isolates Escape and captured combos via stopPropagation() and preserves focus on two-step confirm unmount', async () => {
    const recovery: RecoveryStateSnapshot = {
      corrupt_path: '/tmp/corrupt.json',
      backup_candidate: '/tmp/bak.json',
      error: 'bad json',
    };
    const windowListener = vi.fn();
    window.addEventListener('keydown', windowListener);
    cleanups.push(() => {
      window.removeEventListener('keydown', windowListener);
    });

    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(SettingsPanel, {
      target,
      props: {
        settings: createDefaultAppSettings(),
        recovery,
        onClose: vi.fn(),
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    // Capture mode for open_settings -> Escape must NOT bubble to window
    const captureBtn = target.querySelector<HTMLButtonElement>(
      '[data-testid="shortcut-capture-open_settings"]',
    )!;
    captureBtn.click();
    await tick();
    expect(captureBtn.getAttribute('aria-pressed')).toBe('true');

    const escDuringCapture = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    (document.activeElement as HTMLElement).dispatchEvent(escDuringCapture);
    await tick();
    expect(escDuringCapture.defaultPrevented).toBe(true);
    expect(windowListener).not.toHaveBeenCalled();
    expect(captureBtn.getAttribute('aria-pressed')).toBe('false');

    // Capture mode -> Mod+, shortcut combo must update shortcut AND NOT bubble to window
    captureBtn.click();
    await tick();
    const comboEvt = new KeyboardEvent('keydown', {
      key: ',',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    (document.activeElement as HTMLElement).dispatchEvent(comboEvt);
    await tick();
    expect(comboEvt.defaultPrevented).toBe(true);
    expect(windowListener).not.toHaveBeenCalled();
    expect(captureBtn.getAttribute('aria-pressed')).toBe('false');

    // Two-step confirmation cancel must keep focus inside SettingsPanel (never drop to document.body)
    const resetTrigger = target.querySelector<HTMLButtonElement>(
      '[data-testid="settings-reset-trigger"]',
    )!;
    resetTrigger.click();
    await tick();
    const resetCancel = target.querySelector<HTMLButtonElement>(
      '[data-testid="settings-reset-cancel"]',
    )!;
    expect(resetCancel).not.toBeNull();
    resetCancel.click();
    await tick();
    const panelEl = target.querySelector<HTMLElement>('[data-testid="settings-panel"]')!;
    expect(panelEl.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('D-160: PalettePanel mode tablist supports roving tabindex, ArrowRight/Home/End, aria-controls, and dynamic search aria-label', async () => {
    const { client } = createMockClient();
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(PalettePanel, {
      target,
      props: { client },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    const commandsTab = target.querySelector<HTMLButtonElement>('[data-palette-mode="commands"]')!;
    const presetsTab = target.querySelector<HTMLButtonElement>('[data-palette-mode="presets"]')!;
    const snippetsTab = target.querySelector<HTMLButtonElement>('[data-palette-mode="snippets"]')!;

    expect(commandsTab.tabIndex).toBe(0);
    expect(presetsTab.tabIndex).toBe(-1);
    expect(snippetsTab.tabIndex).toBe(-1);

    const controlsId = commandsTab.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    const tabpanel = target.querySelector(`[role="tabpanel"]#${controlsId}`);
    expect(tabpanel).not.toBeNull();

    commandsTab.focus();
    commandsTab.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await tick();
    expect(presetsTab.getAttribute('aria-selected')).toBe('true');
    expect(presetsTab.tabIndex).toBe(0);
    expect(commandsTab.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(presetsTab);

    presetsTab.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await tick();
    expect(snippetsTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(snippetsTab);

    const searchInput = target.querySelector<HTMLInputElement>('.ms-search-input')!;
    expect(searchInput.getAttribute('aria-label')).not.toBe('搜索命令或预置');
    expect(searchInput.getAttribute('aria-label')).toContain('片段');

    snippetsTab.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
    );
    await tick();
    expect(commandsTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(commandsTab);
  });

  it('D-160: SettingsPanel theme, render_backend, and delimiter radiogroups support roving tabindex and Arrow keys', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(SettingsPanel, {
      target,
      props: {
        settings: createDefaultAppSettings(),
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    // Theme radiogroup (default is 'system')
    const lightTheme = target.querySelector<HTMLButtonElement>('[data-testid="theme-option-light"]')!;
    const darkTheme = target.querySelector<HTMLButtonElement>('[data-testid="theme-option-dark"]')!;
    const systemTheme = target.querySelector<HTMLButtonElement>('[data-testid="theme-option-system"]')!;
    expect(systemTheme.tabIndex).toBe(0);
    expect(lightTheme.tabIndex).toBe(-1);

    systemTheme.focus();
    systemTheme.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await tick();
    expect(lightTheme.getAttribute('aria-checked')).toBe('true');
    expect(lightTheme.tabIndex).toBe(0);
    expect(systemTheme.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(lightTheme);

    lightTheme.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    await tick();
    expect(darkTheme.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(darkTheme);

    // Delimiter radiogroup
    const noneDelim = target.querySelector<HTMLButtonElement>(
      '[data-testid="delimiter-option-none"]',
    )!;
    const inlineDelim = target.querySelector<HTMLButtonElement>(
      '[data-testid="delimiter-option-inline_dollar"]',
    )!;
    expect(noneDelim.tabIndex).toBe(0);
    expect(inlineDelim.tabIndex).toBe(-1);
    noneDelim.focus();
    noneDelim.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await tick();
    expect(inlineDelim.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(inlineDelim);
  });

  it('D-160: MathSlotEditor removes aria-label from unroled .ms-header-meta div and keeps line/slot text', async () => {
    const { client } = createMockClient();
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(MathSlotEditor, {
      target,
      props: { client },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    const meta = target.querySelector<HTMLElement>('.ms-header-meta')!;
    expect(meta).not.toBeNull();
    expect(meta.hasAttribute('aria-label')).toBe(false);
    expect(meta.textContent).toContain('1 行');
    expect(meta.textContent).toContain('0 槽位');
  });

  it('D-158 / D-159: tokens.css and MathSlotEditor provide WCAG AA tokens, .cm-placeholder contrast, and prefers-reduced-motion: reduce', () => {
    const tokensCss = readUiSource('src/theme/tokens.css');
    const editorSrc = readUiSource('src/editor/MathSlotEditor.svelte');
    expect(tokensCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(tokensCss).toContain('transition-duration: 0s');
    expect(tokensCss).not.toMatch(/--ms-fg-subtle:\s*#64748b\b/);
    expect(tokensCss).not.toMatch(/--ms-obs-fallback-fg-faint:\s*#64748b\b/);
    expect(tokensCss).not.toMatch(/--ms-status-warn-fg:\s*var\(--ms-obs-warning\)/);
    expect(tokensCss).not.toMatch(/--ms-status-error-fg:\s*var\(--ms-obs-error\)/);
    expect(tokensCss).not.toMatch(/--ms-status-success-fg:\s*var\(--ms-obs-success\)/);
    expect(tokensCss).not.toMatch(/--ms-badge-degraded-fg:\s*var\(--ms-obs-warning\)/);
    expect(tokensCss).not.toMatch(/--ms-slot-empty-fg:\s*var\(--ms-obs-warning\)/);
    expect(editorSrc).toContain('.cm-placeholder');
  });
});
