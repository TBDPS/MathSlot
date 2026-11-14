import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const ARTIFACT_DIR = resolve(import.meta.dirname, '../../.e2e-artifacts');
mkdirSync(ARTIFACT_DIR, { recursive: true });

test.describe('MathSlot Desktop Playwright E2E (T3.5 / S-001..S-007 / A-UI-001..005)', () => {
  test('S-001 / S-007 / A-UI-002: stream typing "▸f1;2;", multiline Enter, Undo/Redo, and strict export blocking', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('desktop-app')).toBeVisible();
    await expect(page.getByTestId('desktop-status-pill')).toHaveText('空闲');

    const cmContent = page.locator('.cm-content');
    await cmContent.click();

    // Stream command typing ▸f1;2;
    await page.keyboard.type('▸f1;2;', { delay: 12 });
    await expect(page.getByTestId('desktop-copy-preview')).toContainText('\\frac{1}{2}');
    await expect(page.getByTestId('mathslot-editor').locator('.cm-content')).toHaveText(
      '\\frac{1}{2}',
    );
    await expect(cmContent).not.toContainText(';');
    await expect(page.getByTestId('preview-viewport').locator('svg')).toBeVisible();

    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'light-short.png'),
      fullPage: false,
    });

    // Clear and verify 3-line Enter multiline editing (S-007 / D-009)
    await page.getByTestId('desktop-clear-btn').click();
    await cmContent.click();
    await page.keyboard.type('a');
    await page.keyboard.press('Enter');
    await page.keyboard.type('b');
    await page.keyboard.press('Enter');
    await page.keyboard.type('c');

    await expect(page.locator('.cm-line')).toHaveCount(3);
    await expect(page.locator('.cm-line')).toHaveText(['a', 'b', 'c']);
    await expect(page.getByTestId('mathslot-editor').locator('.ms-header-meta')).toContainText(
      '3 行',
    );

    // Undo and Redo stay synchronized with CM6 doc
    await page.keyboard.press('Control+z');
    await expect(page.locator('.cm-line')).toHaveText(['a', 'b', '']);
    await expect(page.locator('.cm-content')).not.toContainText('c');
    await page.keyboard.press('Control+Shift+Z');
    await expect(page.locator('.cm-line')).toHaveText(['a', 'b', 'c']);
    await expect(page.locator('.cm-content')).toContainText('c');

    // Pending command prefix blocks strict export (S-005)
    await page.getByTestId('desktop-clear-btn').click();
    await cmContent.click();
    await page.keyboard.type('▸');
    await expect(page.getByTestId('desktop-status-pill')).toHaveText('命令前缀 ▸');
    await page.getByTestId('desktop-export-strict-btn').click();
    await expect(page.getByTestId('desktop-toast')).toContainText('阻断');
    await expect(page.getByTestId('mathslot-diagnostics')).toContainText('PENDING_COMMAND');
  });

  test('S-003 / A-UI-003: 3x3 matrix navigation tree shows 9 slots without overflow or clipping', async ({
    page,
  }) => {
    await page.goto('/');
    // Search and apply 3x3 matrix command (id: matrix_3x3)
    const search = page.locator('.ms-search-input');
    await search.fill('3×3');
    await page.locator('[data-command-card="matrix_3x3"]').click();

    const navItems = page.locator('.ms-tree-item[data-slot-id]');
    await expect(navItems).toHaveCount(9);

    const navScroll = page.locator('.ms-nav-scroll');
    const navBox = await navScroll.boundingBox();
    expect(navBox).not.toBeNull();
    expect(navBox!.width).toBeGreaterThan(200);

    // Ensure no horizontal overflow on nav list
    const overflowX = await navScroll.evaluate((el) => {
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflowX).toBeLessThanOrEqual(2);

    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'matrix-nav.png'),
      fullPage: false,
    });
  });

  test('S-002 / A-UI-005 / A-UI-001: ImportModal blocks syntax error, accepts valid LaTeX, and respects Tab/focus_editor', async ({
    page,
  }) => {
    await page.goto('/');
    const cmContent = page.locator('.cm-content');
    await cmContent.click();
    await page.keyboard.type('▸f1;2;', { delay: 12 });
    await expect(page.getByTestId('desktop-copy-preview')).toContainText('\\frac{1}{2}');

    // Tab escapes focus out of CM6 (A-UI-001)
    await page.keyboard.press('Tab');
    const isStillInCm = await page.evaluate(() => {
      return Boolean(document.activeElement?.closest('.cm-editor'));
    });
    expect(isStillInCm).toBe(false);

    // Focus editor shortcut Mod+E returns focus to CM6
    await page.keyboard.press('Control+e');
    const isBackInCm = await page.evaluate(() => {
      return Boolean(document.activeElement?.closest('.cm-editor'));
    });
    expect(isBackInCm).toBe(true);

    // Open ImportModal and test syntax error blocking (Step 1 Preview -> Apply disabled)
    await page.getByTestId('desktop-import-btn').click();
    await expect(page.getByTestId('import-modal')).toBeVisible();

    // D-146: single modal header + non-wrapping single-line close button
    await expect(page.getByRole('heading', { name: '导入 LaTeX 公式' })).toHaveCount(1);
    const closeBtn = page.getByTestId('import-close-btn');
    await expect(closeBtn).toBeVisible();
    const closeBox = await closeBtn.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(closeBox!.height).toBeLessThanOrEqual(42);
    expect(closeBox!.width).toBeGreaterThanOrEqual(40);

    await page.getByTestId('import-latex-input').fill('\\frac{1}{');
    await page.getByTestId('import-submit-btn').click();

    await expect(page.getByTestId('import-report')).toBeVisible();
    await expect(page.getByTestId('import-blocked-banner')).toBeVisible();
    await expect(page.getByTestId('import-apply-btn')).toBeDisabled();
    // D-144: raw_nodes === 0 && blocked must NOT show RawLatex 降级 pill
    await expect(page.getByTestId('import-diff-view')).not.toContainText('RawLatex 降级');
    await expect(page.getByTestId('import-diff-pill')).toContainText('语法错误已阻断');
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'import-error-blocking.png'),
      fullPage: false,
    });
    // Prior formula remains untouched!
    await expect(page.getByTestId('desktop-copy-preview')).toContainText('\\frac{1}{2}');

    // Now preview & apply valid long formula and screenshot (S-004 / long-formula)
    await page
      .getByTestId('import-latex-input')
      .fill(
        '\\int_{0}^{\\infty} \\frac{\\sqrt{x^2 + \\alpha}}{1 + e^{x}} \\, dx = \\sum_{k=1}^{n} \\frac{a_k}{b_k}',
      );
    await page.getByTestId('import-submit-btn').click();
    await expect(page.getByTestId('import-lossless-banner')).toBeVisible();
    await page.getByTestId('import-apply-btn').click();
    await expect(page.getByTestId('import-modal')).toHaveCount(0);

    await expect(page.getByTestId('preview-viewport').locator('svg')).toBeVisible();
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'long-formula.png'),
      fullPage: false,
    });
  });

  test('T4.1 / D-140 / D-142 / D-012 / D-146: two-phase Diff preview, RawLatex warning badge, 720p scroll, Cancel non-mutation, Apply & 1-step Undo', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    const cmContent = page.locator('.cm-content');
    await cmContent.click();
    await page.keyboard.type('▸f1;2;', { delay: 12 });
    await expect(page.getByTestId('desktop-copy-preview')).toContainText('\\frac{1}{2}');

    // Preview unsupported align with outer $$...$$ delimiters
    await page.getByTestId('desktop-import-btn').click();
    await page.getByTestId('import-latex-input').fill('$$\\begin{align} a &= b \\\\ c &= d \\end{align}$$');
    await page.getByTestId('import-submit-btn').click();

    await expect(page.getByTestId('import-diff-view')).toBeVisible();
    await expect(page.getByTestId('import-degraded-badge')).toBeVisible();
    await expect(page.getByTestId('import-diagnostics-list')).toContainText('OUTER_DELIMITERS_STRIPPED');
    await expect(page.getByTestId('import-diagnostics-list')).toContainText('UNSUPPORTED_ENVIRONMENT');
    await expect(page.getByTestId('import-apply-btn')).toBeEnabled();

    // D-146: ensure all diagnostics are comfortably reachable/visible inside 1280x720 modal viewport
    const lastDiag = page.getByTestId('import-diagnostics-list').locator('li').last();
    await lastDiag.scrollIntoViewIfNeeded();
    await expect(lastDiag).toBeVisible();
    const lastDiagBox = await lastDiag.boundingBox();
    expect(lastDiagBox).not.toBeNull();
    expect(lastDiagBox!.y + lastDiagBox!.height).toBeLessThanOrEqual(720);

    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'import-diff-warning.png'),
      fullPage: false,
    });

    // Preview alone and Cancel must NOT mutate document
    await page.getByTestId('import-cancel-btn').click();
    await expect(page.getByTestId('import-modal')).toHaveCount(0);
    await expect(page.getByTestId('desktop-copy-preview')).toContainText('\\frac{1}{2}');

    // Re-open, Preview $$\\sqrt{x+1}$$, Apply -> strips delimiters, then Control+z 1-step Undo restores \\frac{1}{2}
    await page.getByTestId('desktop-import-btn').click();
    await page.getByTestId('import-latex-input').fill('$$\\sqrt{x+1}$$');
    await page.getByTestId('import-submit-btn').click();
    await expect(page.getByTestId('import-roundtrip-latex')).toContainText('\\sqrt{x+1}');
    await page.getByTestId('import-apply-btn').click();
    await expect(page.getByTestId('import-modal')).toHaveCount(0);
    await expect(page.getByTestId('desktop-copy-preview')).toContainText('\\sqrt{x+1}');

    await cmContent.click();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('desktop-copy-preview')).toContainText('\\frac{1}{2}');
  });

  test('S-004 / D-130: latex-rust backend fallback surfaces degraded badge and readable diagnostics', async ({
    page,
  }) => {
    await page.goto('/');
    // Switch backend to latex-rust in Settings
    await page.getByTestId('desktop-settings-btn').click();
    await page.getByTestId('backend-option-latex-rust').click();
    await page.getByTestId('settings-save-btn').click();
    await page.getByTestId('desktop-close-settings-btn').click();

    // Import expression containing unsupported macro trigger so latex-rust degrades cleanly
    await page.getByTestId('desktop-import-btn').click();
    await page.getByTestId('import-latex-input').fill('\\frac{1}{2} + \\unknownFallbackTest{x}');
    await page.getByTestId('import-submit-btn').click();
    await expect(page.getByTestId('import-degraded-badge')).toBeVisible();
    await page.getByTestId('import-apply-btn').click();
    await expect(page.getByTestId('import-modal')).toHaveCount(0);

    await expect(page.getByTestId('degraded-badge')).toBeVisible();
    await expect(page.getByTestId('preview-error-summary')).toBeVisible();
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'error-diagnostics.png'),
      fullPage: false,
    });
  });

  test('S-006 / A-UI-004 / D-016: Dark theme computed colors + shortcut conflict blocking + corrupt recovery wizard', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__MATHSLOT_DESKTOP_BRIDGE__ = {
        snapshot: async () => ({
          state: 'Idle',
          latex: '\\frac{a}{b}',
          preview_latex: '\\frac{a}{b}',
          copy_text: '\\frac{a}{b}',
          source: '\\frac{a}{b}',
          cursor_char: 11,
          has_pending_command: false,
          is_composing: false,
          is_nav_mode: false,
          can_undo: false,
          can_redo: false,
          slots: [],
          diagnostics: [],
          active_slot_id: null,
          settings: {
            theme: 'dark',
            delimiter_style: 'inline_dollar',
            render_backend: 'mathjax',
            shortcuts: {
              nav_next_slot: 'j',
              nav_prev_slot: 'k',
              nav_parent: 'h',
              nav_first_child: 'l',
              copy_latex: 'Mod+Shift+C',
              save_snippet: 'Mod+Shift+S',
              focus_editor: 'Mod+E',
              toggle_nav: 'Mod+J',
              open_settings: 'Mod+,',
            },
            config_path: '/tmp/library.json',
            preview_scale_pct: 110,
          },
          recovery: {
            corrupt_path: '/tmp/library.corrupt-999.json',
            backup_candidate: '/tmp/library.bak-998.json',
            error: 'invalid JSON at line 1',
          },
          last_import: null,
        }),
      };
    });

    await page.goto('/');
    const shell = page.getByTestId('desktop-app');
    await expect(shell).toHaveAttribute('data-theme', 'dark');

    // Verify computed background is genuinely dark (not light fallback) and readable text contrast
    const colors = await shell.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        bg: style.backgroundColor,
        fg: style.color,
      };
    });
    expect(colors.bg).not.toBe('rgb(255, 255, 255)');
    expect(colors.bg).not.toBe(colors.fg);

    // Recovery wizard auto-opened on corrupt startup
    await expect(page.getByTestId('recovery-wizard')).toBeVisible();
    await expect(page.getByTestId('recovery-wizard')).toContainText('/tmp/library.corrupt-999.json');

    // Shortcut conflict blocks save
    await page.getByTestId('shortcut-input-save_snippet').fill('Mod+Shift+C');
    await expect(page.getByTestId('shortcut-conflict-banner')).toBeVisible();
    await expect(page.getByTestId('settings-save-btn')).toBeDisabled();

    // Restore valid shortcut
    await page.getByTestId('shortcut-input-save_snippet').fill('Mod+Shift+S');
    await expect(page.getByTestId('shortcut-conflict-banner')).toHaveCount(0);

    await page.getByTestId('desktop-close-settings-btn').click();
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'dark-theme.png'),
      fullPage: false,
    });
  });

  test('T4.2 / D-147 / D-148 / D-149 / D-150 / D-151: real click recovery restore, two-step reset, save failure banner, and Obsidian config import', async ({
    page,
  }) => {
    // 1. Corrupt startup wizard -> real click Restore Backup + Two-Step Empty Reset
    await page.addInitScript(() => {
      const mode = new URLSearchParams(window.location.search).get('t42mode');
      if (mode === 'recovery') {
        let recoveryState: { corrupt_path: string; backup_candidate: string | null; error: string } | null = {
          corrupt_path: '/tmp/library.corrupt-e2e.json',
          backup_candidate: '/tmp/library.bak-e2e.json',
          error: 'EOF while parsing object at line 1 column 14',
        };
        let formulas: Array<{
          id: string;
          name: string;
          category: string;
          source: string;
          desc: string;
          tags: string[];
          is_builtin: boolean;
          created_at: number;
        }> = [];
        const defaultSettings = {
          theme: 'light' as const,
          delimiter_style: 'inline_dollar' as const,
          render_backend: 'mathjax' as const,
          shortcuts: {
            nav_next_slot: 'j',
            nav_prev_slot: 'k',
            nav_parent: 'h',
            nav_first_child: 'l',
            copy_latex: 'Mod+Shift+C',
            save_snippet: 'Mod+Shift+S',
            focus_editor: 'Mod+E',
            toggle_nav: 'Mod+J',
            open_settings: 'Mod+,',
          },
          config_path: '/tmp/library.json',
          preview_scale_pct: 100,
        };
        const mkSnap = () => ({
          state: 'Idle' as const,
          latex: 'x',
          preview_latex: 'x',
          copy_text: 'x',
          source: 'x',
          cursor_char: 1,
          has_pending_command: false,
          is_composing: false,
          is_nav_mode: false,
          can_undo: false,
          can_redo: false,
          slots: [],
          diagnostics: [],
          active_slot_id: null,
          settings: defaultSettings,
          recovery: recoveryState,
          last_import: null,
        });
        window.__MATHSLOT_DESKTOP_BRIDGE__ = {
          snapshot: async () => mkSnap(),
          dispatch: async (event: unknown) => {
            if (
              recoveryState &&
              (event === 'RequestSaveSnippet' ||
                event === 'ResetSettingsConfirmed' ||
                (typeof event === 'object' && event !== null && 'UpdateSettings' in event))
            ) {
              throw new Error('存在未解决的配置损坏恢复状态，请先从备份恢复或重置为空配置');
            }
            return { snapshot: mkSnap(), effects: [] };
          },
          getUserFormulas: async () => formulas,
          restoreBackup: async () => {
            recoveryState = null;
            formulas = [
              {
                id: '01933b4a-8888-7000-8000-000000000008',
                name: 'Restored Backup Formula',
                category: '自定义',
                source: '\\alpha + \\beta',
                desc: 'from backup',
                tags: ['backup'],
                is_builtin: false,
                created_at: 1700000100,
              },
            ];
            return mkSnap();
          },
          resetEmptyConfig: async () => {
            recoveryState = null;
            formulas = [];
            return mkSnap();
          },
        };
      } else if (mode === 'failsave') {
        window.__MATHSLOT_DESKTOP_BRIDGE__ = {
          dispatch: async (event: unknown) => {
            if (typeof event === 'object' && event !== null && 'UpdateSettings' in event) {
              throw new Error('PermissionDenied: read-only config directory');
            }
            if (event === 'ResetSettingsConfirmed') {
              throw new Error('ENOSPC: no space left on device');
            }
            throw new Error('Unexpected write during failsave harness');
          },
        };
      }
    });

    await page.goto('/?t42mode=recovery');
    await expect(page.getByTestId('recovery-wizard')).toBeVisible();
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'desktop-recovery-wizard.png'),
      fullPage: false,
    });

    // Click Restore Backup -> wizard disappears and backup formula appears
    await page.getByTestId('recovery-restore-btn').click();
    await expect(page.getByTestId('recovery-wizard')).toHaveCount(0);
    await page.getByTestId('desktop-close-settings-btn').click();
    await expect(page.locator('[data-palette-mode="snippets"]')).toContainText('片段 (1)');

    // Reload recovery mode and test two-step Reset Empty Config
    await page.goto('/?t42mode=recovery');
    await expect(page.getByTestId('recovery-wizard')).toBeVisible();
    await page.getByTestId('recovery-reset-trigger').click();
    await expect(page.getByTestId('recovery-reset-confirm-box')).toBeVisible();
    await page.getByTestId('recovery-reset-confirm').click();
    await expect(page.getByTestId('recovery-wizard')).toHaveCount(0);
    await page.getByTestId('desktop-close-settings-btn').click();
    await expect(page.locator('[data-palette-mode="snippets"]')).toContainText('片段 (0)');

    // 2. Save failure keeps dirty badge, shows settings-save-error, never shows "设置已应用"
    await page.goto('/?t42mode=failsave');
    await page.getByTestId('desktop-settings-btn').click();
    await page.getByTestId('theme-option-dark').click();
    await expect(page.getByTestId('settings-panel')).toContainText('有未保存更改');
    await page.getByTestId('settings-save-btn').click();
    await expect(page.getByTestId('settings-save-error')).toBeVisible();
    await expect(page.getByTestId('settings-save-error')).toContainText('PermissionDenied');
    await expect(page.getByTestId('settings-panel')).not.toContainText('设置已应用');
    await expect(page.getByTestId('settings-panel')).toContainText('有未保存更改');
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'desktop-settings-save-error.png'),
      fullPage: false,
    });

    // 3. Real browser harness bidirectional Obsidian v2 config import via file chooser
    await page.goto('/');
    await page.getByTestId('desktop-settings-btn').click();
    const obsidianExportedV2 = JSON.stringify({
      schema_version: 2,
      customFormats: [],
      snippets: [
        {
          id: 'obs-export-1',
          name: 'Obsidian 导出片段',
          category: '自定义',
          source: 'E = h\\nu',
          desc: 'from obsidian',
          tags: ['obsidian'],
          is_builtin: false,
          created_at: 1700000250,
        },
      ],
      settings: {
        theme: 'dark',
        delimiter_style: 'inline_dollar',
        render_backend: 'mathjax',
        preview_scale_pct: 125,
      },
    });
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByTestId('settings-import-btn').click(),
    ]);
    await fileChooser.setFiles({
      name: 'obsidian-export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(obsidianExportedV2, 'utf-8'),
    });
    await expect(page.getByTestId('desktop-app')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('desktop-close-settings-btn').click();
    await expect(page.locator('[data-palette-mode="snippets"]')).toContainText('片段 (1)');
  });
});
