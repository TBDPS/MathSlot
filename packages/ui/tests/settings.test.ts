import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import SettingsPanel from '../src/settings/SettingsPanel.svelte';
import {
  DEFAULT_SHORTCUTS,
  isReservedShortcut,
  matchesShortcut,
  normalizeShortcut,
  validateShortcuts,
} from '../src/settings/shortcuts';
import {
  createDefaultAppSettings,
  createEmptySnapshot,
  type AppEvent,
  type AppSettings,
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
      return {
        effects: [],
        snapshot: createEmptySnapshot(),
      };
    }),
    snapshot: vi.fn(async () => createEmptySnapshot()),
    engineVersion: vi.fn(async () => '0.7.0-test'),
  };
  return { client, events };
}

describe('Shortcuts normalization, reserved keys, conflict detection (D-118)', () => {
  it('normalizes Ctrl / Cmd / Mod / Shift / Alt combinations deterministically', () => {
    expect(normalizeShortcut('ctrl+shift+c')).toBe('Mod+Shift+C');
    expect(normalizeShortcut('Cmd + Shift + c')).toBe('Mod+Shift+C');
    expect(normalizeShortcut('shift+alt+mod+s')).toBe('Mod+Alt+Shift+S');
    expect(normalizeShortcut('alt + i')).toBe('Alt+I');
    expect(normalizeShortcut('tab')).toBe('Tab');
    expect(normalizeShortcut('shift+tab')).toBe('Shift+Tab');
    expect(normalizeShortcut('esc')).toBe('Escape');
  });

  it('matches KeyboardEvent against normalized shortcuts', () => {
    const evtModAltC = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      altKey: true,
    });
    expect(matchesShortcut(evtModAltC, 'Mod+Alt+C')).toBe(true);
    expect(matchesShortcut(evtModAltC, 'Mod+Shift+C')).toBe(false);

    const evtAltI = new KeyboardEvent('keydown', {
      key: 'I',
      altKey: true,
    });
    expect(matchesShortcut(evtAltI, 'Alt+I')).toBe(true);
  });

  it('rejects reserved keys (Tab, Shift+Tab, Escape, single chars, Enter/Backspace/Delete/Arrow/Mod+C/Z)', () => {
    const reserved = [
      'Tab',
      'Shift+Tab',
      'Escape',
      'a',
      '1',
      '+',
      'Enter',
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Mod+Z',
      'Mod+Shift+Z',
      'Mod+Y',
      'Mod+C',
      'Mod+X',
      'Mod+V',
      'Mod+A',
    ];
    for (const key of reserved) {
      expect(isReservedShortcut(key), `Expected ${key} to be reserved`).toBe(true);
    }
    expect(isReservedShortcut('Mod+Alt+C')).toBe(false);
    expect(isReservedShortcut('Alt+I')).toBe(false);
  });

  it('detects cross-action conflicts and reserved-key violations in validateShortcuts', () => {
    const clean = validateShortcuts(DEFAULT_SHORTCUTS);
    expect(clean.valid).toBe(true);
    expect(clean.issues).toHaveLength(0);

    const duplicate = validateShortcuts({
      ...DEFAULT_SHORTCUTS,
      save_snippet: 'Ctrl+Shift+C', // conflicts with copy_latex ('Mod+Shift+C')
    });
    expect(duplicate.valid).toBe(false);
    expect(duplicate.byAction.copy_latex?.some((i) => i.code === 'CONFLICT')).toBe(true);
    expect(duplicate.byAction.save_snippet?.some((i) => i.code === 'CONFLICT')).toBe(true);

    const reservedViolation = validateShortcuts({
      ...DEFAULT_SHORTCUTS,
      copy_latex: 'a',
      focus_editor: 'Tab',
    });
    expect(reservedViolation.valid).toBe(false);
    expect(reservedViolation.byAction.copy_latex?.some((i) => i.code === 'RESERVED_KEY')).toBe(
      true,
    );
    expect(reservedViolation.byAction.focus_editor?.some((i) => i.code === 'RESERVED_KEY')).toBe(
      true,
    );
  });
});

describe('SettingsPanel.svelte (T3.4 / D-117 / D-016 / A-DATA-001)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    document.body.innerHTML = '';
  });

  it('renders theme, delimiter + live preview, render backend, config path, import/export, and saves valid updates', async () => {
    const { client, events } = createMockClient();
    const onSaveSettings = vi.fn();
    const onImportConfig = vi.fn();
    const onExportConfig = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);

    const initial: AppSettings = {
      ...createDefaultAppSettings(),
      config_path: '/home/user/.config/mathslot/library.json',
    };

    const app = mount(SettingsPanel, {
      target,
      props: {
        settings: initial,
        client,
        sampleLatex: '\\frac{a}{b}',
        onSaveSettings,
        onImportConfig,
        onExportConfig,
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    // Config path displayed
    const pathEl = target.querySelector('[data-testid="settings-config-path"]');
    expect(pathEl?.textContent).toContain('/home/user/.config/mathslot/library.json');

    // Switch theme to dark
    const darkBtn = target.querySelector<HTMLButtonElement>('[data-testid="theme-option-dark"]');
    expect(darkBtn).not.toBeNull();
    darkBtn!.click();
    await tick();
    const shell = target.querySelector('[data-testid="settings-panel"]');
    expect(shell?.getAttribute('data-theme')).toBe('dark');

    // Switch delimiter to inline_dollar and observe live preview
    const inlineBtn = target.querySelector<HTMLButtonElement>(
      '[data-testid="delimiter-option-inline_dollar"]',
    );
    expect(inlineBtn).not.toBeNull();
    inlineBtn!.click();
    await tick();
    const previewEl = target.querySelector('[data-testid="delimiter-preview"]');
    expect(previewEl?.textContent).toContain('$\\frac{a}{b}$');

    // Switch render backend to latex-rust
    const rustBtn = target.querySelector<HTMLButtonElement>(
      '[data-testid="backend-option-latex-rust"]',
    );
    expect(rustBtn).not.toBeNull();
    rustBtn!.click();
    await tick();

    // Save settings
    const saveBtn = target.querySelector<HTMLButtonElement>('[data-testid="settings-save-btn"]');
    expect(saveBtn).not.toBeNull();
    expect(saveBtn!.disabled).toBe(false);
    saveBtn!.click();
    await tick();

    expect(onSaveSettings).toHaveBeenCalledTimes(1);
    const savedArg = onSaveSettings.mock.calls[0]?.[0] as AppSettings;
    expect(savedArg.theme).toBe('dark');
    expect(savedArg.delimiter_style).toBe('inline_dollar');
    expect(savedArg.render_backend).toBe('latex-rust');
    expect(events).toContainEqual({ UpdateSettings: savedArg });

    // Import & Export buttons
    target.querySelector<HTMLButtonElement>('[data-testid="settings-import-btn"]')?.click();
    target.querySelector<HTMLButtonElement>('[data-testid="settings-export-btn"]')?.click();
    await tick();
    expect(onImportConfig).toHaveBeenCalledTimes(1);
    expect(onExportConfig).toHaveBeenCalledTimes(1);
    expect(events).toContain('RequestImportConfig');
    expect(events).toContain('RequestExportConfig');
  });

  it('highlights shortcut conflicts and blocks saving until resolved (D-118)', async () => {
    const onSaveSettings = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(SettingsPanel, {
      target,
      props: {
        settings: createDefaultAppSettings(),
        onSaveSettings,
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    const saveSnippetInput = target.querySelector<HTMLInputElement>(
      '[data-testid="shortcut-input-save_snippet"]',
    );
    expect(saveSnippetInput).not.toBeNull();

    // Conflict with copy_latex ('Mod+Shift+C')
    saveSnippetInput!.value = 'Mod+Shift+C';
    saveSnippetInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    const banner = target.querySelector('[data-testid="shortcut-conflict-banner"]');
    expect(banner).not.toBeNull();
    expect(saveSnippetInput!.getAttribute('aria-invalid')).toBe('true');

    const saveBtn = target.querySelector<HTMLButtonElement>('[data-testid="settings-save-btn"]');
    expect(saveBtn!.disabled).toBe(true);
    saveBtn!.click();
    await tick();
    expect(onSaveSettings).not.toHaveBeenCalled();

    // Fix to non-conflicting key
    saveSnippetInput!.value = 'Mod+Alt+S';
    saveSnippetInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    expect(target.querySelector('[data-testid="shortcut-conflict-banner"]')).toBeNull();
    expect(saveBtn!.disabled).toBe(false);
    saveBtn!.click();
    await tick();
    expect(onSaveSettings).toHaveBeenCalledTimes(1);
  });

  it('requires two-step confirmation for restoring defaults and renders corrupt recovery wizard (D-016 / A-DATA-001)', async () => {
    const { client, events } = createMockClient();
    const onResetDefaults = vi.fn();
    const onRestoreBackup = vi.fn();
    const onConfirmResetEmpty = vi.fn();

    const recovery: RecoveryStateSnapshot = {
      corrupt_path: '/tmp/library.corrupt-123.json',
      backup_candidate: '/tmp/library.bak-122.json',
      error: 'expected value at line 1 column 1',
    };

    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(SettingsPanel, {
      target,
      props: {
        settings: {
          ...createDefaultAppSettings(),
          theme: 'dark',
        },
        recovery,
        client,
        onResetDefaults,
        onRestoreBackup,
        onConfirmResetEmpty,
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    // Recovery wizard visible
    const recoveryAlert = target.querySelector('[data-testid="recovery-wizard"]');
    expect(recoveryAlert).not.toBeNull();
    expect(recoveryAlert!.textContent).toContain('/tmp/library.corrupt-123.json');
    expect(recoveryAlert!.textContent).toContain('/tmp/library.bak-122.json');

    // Restore from backup button
    target.querySelector<HTMLButtonElement>('[data-testid="recovery-restore-btn"]')?.click();
    await tick();
    expect(onRestoreBackup).toHaveBeenCalledWith('/tmp/library.bak-122.json');
    expect(events).toContain('RequestRestoreBackup');

    // Two-step confirmation for empty config reset
    target.querySelector<HTMLButtonElement>('[data-testid="recovery-reset-trigger"]')?.click();
    await tick();
    expect(onConfirmResetEmpty).not.toHaveBeenCalled();

    const confirmEmptyBtn = target.querySelector<HTMLButtonElement>(
      '[data-testid="recovery-reset-confirm"]',
    );
    expect(confirmEmptyBtn).not.toBeNull();
    confirmEmptyBtn!.click();
    await tick();
    expect(onConfirmResetEmpty).toHaveBeenCalledTimes(1);
    expect(events).toContain('ConfirmResetEmptyConfig');

    // Two-step confirmation for restoring default settings
    target.querySelector<HTMLButtonElement>('[data-testid="settings-reset-trigger"]')?.click();
    await tick();
    expect(onResetDefaults).not.toHaveBeenCalled();

    const confirmDefaultsBtn = target.querySelector<HTMLButtonElement>(
      '[data-testid="settings-reset-confirm"]',
    );
    expect(confirmDefaultsBtn).not.toBeNull();
    confirmDefaultsBtn!.click();
    await tick();
    expect(onResetDefaults).toHaveBeenCalledTimes(1);
    expect(events).toContain('ResetSettingsConfirmed');
  });
});
