import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type * as PlaywrightTest from '../../../desktop/node_modules/@playwright/test/index';

const require = createRequire(import.meta.url);
const { expect, test } = require('../../../desktop/node_modules/@playwright/test/index.js') as typeof PlaywrightTest;
const processMod = 'node:process';
const { env } = require(processMod) as { env: Record<string, string | undefined> };

const ARTIFACT_DIR = resolve(import.meta.dirname, '../../.e2e-artifacts');
mkdirSync(ARTIFACT_DIR, { recursive: true });

test.describe('MathSlot Obsidian Playwright E2E (T3.7 / A-OBS-001..005 / D-131..D-136)', () => {
  test('Desktop 1280x800: stream typing "▸f1;2;" renders "\\frac{1}{2}" without ";", saves snippet, and renders SVG preview', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/harness.html');

    const hostRoot = page.locator('[data-host="obsidian"]');
    await expect(hostRoot).toBeVisible();
    await expect(hostRoot).toHaveAttribute('data-theme', 'light');

    const cmContent = page.locator('.cm-content');
    await cmContent.click();

    await page.keyboard.type('▸f1;2;', { delay: 15 });
    await expect(cmContent).toHaveText('\\frac{1}{2}');
    await expect(cmContent).not.toContainText(';');
    await expect(page.getByTestId('preview-viewport').locator('svg')).toBeVisible();

    // Save custom snippet and verify in PalettePanel snippets tab (D-135)
    await page.getByTestId('obsidian-save-snippet-btn').click();
    const snippetsTab = page.locator('[data-palette-mode="snippets"]');
    await expect(snippetsTab).toContainText('片段 (1)');
    await snippetsTab.click();
    await expect(page.locator('[data-snippet-card]')).toHaveCount(1);
    await expect(page.locator('[data-snippet-card]').first()).toContainText('\\frac{1}{2}');

    // Switch back to commands tab before screenshot
    await page.locator('[data-palette-mode="commands"]').click();
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'obsidian-desktop-light.png'),
      fullPage: false,
    });
  });

  test('D-132 / D-135: SettingsPanel Dark theme + preview_scale_pct save immediately syncs live WASM snapshot and theme', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/harness.html');

    const hostRoot = page.locator('[data-host="obsidian"]');
    await expect(hostRoot).toHaveAttribute('data-theme', 'light');

    const cmContent = page.locator('.cm-content');
    await cmContent.click();
    await page.keyboard.type('▸f1;2;', { delay: 12 });
    await expect(cmContent).toHaveText('\\frac{1}{2}');

    await page.getByTestId('obsidian-settings-btn').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();

    // Obsidian constrains render_backend to mathjax (no latex-rust option)
    await expect(page.getByTestId('backend-option-mathjax')).toBeVisible();
    await expect(page.getByTestId('backend-option-latex-rust')).toHaveCount(0);

    // Switch theme to dark and scale to 125%
    await page.getByTestId('theme-option-dark').click();
    await page.getByTestId('settings-preview-scale').fill('125');
    await page.getByTestId('settings-save-btn').click();

    // Immediately applies dark theme and 125% preview scale while modal is open
    await expect(hostRoot).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('zoom-percent')).toContainText('125%');

    const colors = await hostRoot.evaluate((el: Element) => {
      const style = getComputedStyle(el);
      return { bg: style.backgroundColor, fg: style.color };
    });
    expect(colors.bg).not.toBe('rgb(255, 255, 255)');
    expect(colors.bg).not.toBe(colors.fg);

    // Close settings with Escape key (D-133)
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-panel')).toHaveCount(0);

    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'obsidian-desktop-dark.png'),
      fullPage: false,
    });
  });

  test('D-133 / D-134: ImportModal keeps round-trip diff open before Confirm Apply, and render failure links PreviewPanel to DiagnosticsPanel', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/harness.html?failRender=1');

    await page.getByTestId('obsidian-import-btn').click();
    await expect(page.getByTestId('import-modal')).toBeVisible();
    await page.getByTestId('import-latex-input').fill('\\frac{a}{b}');
    await page.getByTestId('import-submit-btn').click();

    // Preview keeps modal open so user can inspect round-trip diff report, then Confirm Apply writes to editor
    await expect(page.getByTestId('import-modal')).toBeVisible();
    await expect(page.getByTestId('import-diff-view')).toBeVisible();
    await expect(page.getByTestId('import-roundtrip-latex')).toContainText('\\frac{a}{b}');
    await page.getByTestId('import-apply-btn').click();
    await expect(page.getByTestId('import-modal')).toHaveCount(0);

    // Host render failure surfaces degraded badge + copy/view actions + DiagnosticsPanel linkage
    await expect(page.getByTestId('degraded-badge')).toBeVisible();
    await expect(page.getByTestId('preview-copy-error-btn')).toBeVisible();
    await expect(page.getByTestId('preview-view-diagnostics-btn')).toBeVisible();
    await expect(page.getByTestId('mathslot-diagnostics')).toContainText('PRIMARY_RENDER_FAILED');

    await page.getByTestId('preview-view-diagnostics-btn').click();
    await expect(page.getByTestId('diagnostics-toggle')).toHaveAttribute('aria-expanded', 'true');

    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'obsidian-render-diagnostics.png'),
      fullPage: false,
    });
  });

  test('T4.1 / D-138..D-142: Obsidian ImportModal Error blocking, RawLatex warning diff, Cancel non-mutation & 1-step Ctrl+Z undo', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/harness.html');

    const cmContent = page.locator('.cm-content');
    await cmContent.click();
    await page.keyboard.type('▸f1;2;', { delay: 12 });
    await expect(cmContent).toHaveText('\\frac{1}{2}');

    // 1) Error input blocks Apply and preserves document
    await page.getByTestId('obsidian-import-btn').click();
    await page.getByTestId('import-latex-input').fill('1 + 2}');
    await page.getByTestId('import-submit-btn').click();
    await expect(page.getByTestId('import-blocked-banner')).toBeVisible();
    await expect(page.getByTestId('import-apply-btn')).toBeDisabled();
    await expect(page.getByTestId('import-diagnostics-list')).toContainText('UNMATCHED_DELIMITER');
    // D-144: blocked state must show blocked error pill, not yellow RawLatex 降级
    await expect(page.getByTestId('import-diff-view')).not.toContainText('RawLatex 降级');
    await expect(page.getByTestId('import-diff-pill')).toContainText('语法错误已阻断');
    // D-145: Obsidian error banner border must resolve to a non-black semantic red theme color
    const errorColors = await page.evaluate(() => {
      const banner = document.querySelector('[data-testid="import-blocked-banner"]') as HTMLElement | null;
      const modal = document.querySelector('[data-testid="import-modal"]') as HTMLElement | null;
      const style = banner ? getComputedStyle(banner) : null;
      const modalStyle = modal ? getComputedStyle(modal) : null;
      return {
        borderColor: style?.borderTopColor ?? '',
        backgroundColor: style?.backgroundColor ?? '',
        tokenErrorBorder: modalStyle?.getPropertyValue('--ms-status-error-border').trim() ?? '',
      };
    });
    expect(errorColors.tokenErrorBorder).not.toBe('');
    expect(errorColors.borderColor).not.toBe('rgb(0, 0, 0)');
    expect(errorColors.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'obsidian-import-error-blocking.png'),
      fullPage: false,
    });

    // 2) Unsupported environment with outer $$...$$ shows RawLatex warning badge & Diff, Cancel does not mutate
    await page.getByTestId('import-latex-input').fill('$$\\begin{align} x &= 1 \\end{align}$$');
    await page.getByTestId('import-submit-btn').click();
    await expect(page.getByTestId('import-diff-view')).toBeVisible();
    await expect(page.getByTestId('import-degraded-badge')).toBeVisible();
    await expect(page.getByTestId('import-apply-btn')).toBeEnabled();
    // D-145: warning badge and apply button must resolve to non-black semantic theme colors
    const warnColors = await page.evaluate(() => {
      const badge = document.querySelector('[data-testid="import-degraded-badge"]') as HTMLElement | null;
      const applyBtn = document.querySelector('[data-testid="import-apply-btn"]') as HTMLElement | null;
      return {
        badgeBorder: badge ? getComputedStyle(badge).borderTopColor : '',
        badgeBg: badge ? getComputedStyle(badge).backgroundColor : '',
        applyBorder: applyBtn ? getComputedStyle(applyBtn).borderTopColor : '',
        applyBg: applyBtn ? getComputedStyle(applyBtn).backgroundColor : '',
      };
    });
    expect(warnColors.badgeBorder).not.toBe('rgb(0, 0, 0)');
    expect(warnColors.badgeBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(warnColors.applyBorder).not.toBe('rgb(0, 0, 0)');
    expect(warnColors.applyBg).not.toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'obsidian-import-diff-warning.png'),
      fullPage: false,
    });

    await page.getByTestId('import-cancel-btn').click();
    await expect(page.getByTestId('import-modal')).toHaveCount(0);
    await expect(cmContent).toHaveText('\\frac{1}{2}');

    // 3) Preview & Apply outer-delimited valid formula, then Control+z 1-step Undo restores \\frac{1}{2}
    await page.getByTestId('obsidian-import-btn').click();
    await page.getByTestId('import-latex-input').fill('$$\\sqrt{x+1}$$');
    await page.getByTestId('import-submit-btn').click();
    await expect(page.getByTestId('import-roundtrip-latex')).toContainText('\\sqrt{x+1}');
    await page.getByTestId('import-apply-btn').click();
    await expect(page.getByTestId('import-modal')).toHaveCount(0);
    await expect(cmContent).toHaveText('\\sqrt{x+1}');

    await cmContent.click();
    await page.keyboard.press('Control+z');
    await expect(cmContent).toHaveText('\\frac{1}{2}');
  });

  test('D-136 / A-OBS-003: Mobile 390x844 (.is-mobile) mounts usable workspace without horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/harness.html?mobile=1');

    const hostRoot = page.locator('[data-host="obsidian"]');
    await expect(hostRoot).toBeVisible();
    await expect(hostRoot).toHaveClass(/is-mobile/);

    const cmContent = page.locator('.cm-content');
    await cmContent.click();
    await page.keyboard.type('▸f1;2;', { delay: 15 });
    await expect(cmContent).toHaveText('\\frac{1}{2}');
    await expect(page.getByTestId('preview-viewport').locator('svg')).toBeVisible();

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - window.innerWidth;
    });
    expect(overflow).toBeLessThanOrEqual(2);

    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'obsidian-mobile-390.png'),
      fullPage: false,
    });
  });

  test('T4.2 / D-147 / D-148 / D-149 / D-151: corrupt recovery wizard, save-snippet block, two-step reset, save-error banner, and Desktop config import', async ({
    page,
  }) => {
    // 1. Corrupt recovery auto-opens wizard, blocks SaveSnippet, and restores backup cleanly
    await page.goto('/harness.html?recovery=1');
    const wizard = page.getByTestId('recovery-wizard');
    await expect(wizard).toBeVisible();
    await expect(wizard).toContainText('lastValidLibraryJson');
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'obsidian-recovery-wizard.png'),
      fullPage: false,
    });

    // Close settings briefly and attempt SaveSnippet -> blocked by recovery lock without mutating snippets
    await page.getByTestId('settings-close-btn').click();
    await expect(page.getByTestId('settings-panel')).toHaveCount(0);
    await page.locator('.cm-content').click();
    await page.keyboard.type('x+1', { delay: 15 });
    await page.getByTestId('obsidian-save-snippet-btn').click();
    await expect(page.locator('.ms-obsidian-status')).toContainText(/恢复|recovery/i);
    await expect(page.locator('[data-palette-mode="snippets"]')).toContainText('片段 (0)');

    // Re-open settings and click Restore Backup -> wizard closes and backed-up formula appears
    await page.getByTestId('obsidian-settings-btn').click();
    await expect(wizard).toBeVisible();
    await page.getByTestId('recovery-restore-btn').click();
    await expect(page.getByTestId('recovery-wizard')).toHaveCount(0);
    await expect(page.locator('[data-palette-mode="snippets"]')).toContainText('片段 (1)');

    // 2. Two-step empty reset on ?recovery=1
    await page.goto('/harness.html?recovery=1');
    await expect(page.getByTestId('recovery-wizard')).toBeVisible();
    await page.getByTestId('recovery-reset-trigger').click();
    await expect(page.getByTestId('recovery-reset-confirm-box')).toBeVisible();
    await page.getByTestId('recovery-reset-confirm').click();
    await expect(page.getByTestId('recovery-wizard')).toHaveCount(0);
    await expect(page.locator('[data-palette-mode="snippets"]')).toContainText('片段 (0)');

    // 3. Save failure in SettingsPanel never shows "设置已应用" and shows settings-save-error banner
    await page.goto('/harness.html?failSave=1');
    await page.getByTestId('obsidian-settings-btn').click();
    await page.getByTestId('theme-option-dark').click();
    await expect(page.getByTestId('settings-panel')).toContainText('有未保存更改');
    await page.getByTestId('settings-save-btn').click();
    await expect(page.getByTestId('settings-save-error')).toBeVisible();
    await expect(page.getByTestId('settings-save-error')).toContainText('EACCES');
    await expect(page.getByTestId('settings-panel')).not.toContainText('设置已应用');
    await expect(page.getByTestId('settings-panel')).toContainText('有未保存更改');
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, 'obsidian-settings-save-error.png'),
      fullPage: false,
    });

    // 4. Bidirectional Desktop LibraryFile v3 config import via file chooser
    await page.goto('/harness.html');
    await page.getByTestId('obsidian-settings-btn').click();
    const desktopConfig = JSON.stringify({
      schema_version: 3,
      custom_formats: [],
      snippets: [],
      user_formulas: [
        {
          id: '01933b4a-5555-7000-8000-000000000005',
          name: 'Desktop 导入公式',
          category: '自定义',
          source: '\\int_0^1 x\\,dx',
          desc: 'bidirectional import',
          tags: ['desktop'],
          created_at: 1700000300,
        },
      ],
      overrides: [],
      settings: {
        theme: 'dark',
        delimiter_style: 'block_dollar',
        render_backend: 'mathjax',
        preview_scale_pct: 140,
      },
    });
    const fsMod = require('node:fs') as {
      writeFileSync: (p: string, d: string, enc: string) => void;
      unlinkSync: (p: string) => void;
    };
    const importTmpPath = resolve(ARTIFACT_DIR, `tmp-obs-import-${Date.now()}.json`);
    fsMod.writeFileSync(importTmpPath, desktopConfig, 'utf-8');
    try {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByTestId('settings-import-btn').click(),
      ]);
      await fileChooser.setFiles(importTmpPath);
    } finally {
      fsMod.unlinkSync(importTmpPath);
    }
    await expect(page.locator('.ms-obsidian-status')).toContainText('已验证并导入');
    await expect(page.locator('[data-host="obsidian"]')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('[data-palette-mode="snippets"]')).toContainText('片段 (1)');
  });

  test('T4.4 / A-UI-001 / D-156..D-161: Obsidian keyboard workflow, dialog focus trap & restore, Tab hygiene, WCAG AA contrast, focus ring, reduced motion, and ariaSnapshot', async ({
    page,
  }) => {
    const shotDir = env.MATHSLOT_A11Y_SCREENSHOT_DIR || ARTIFACT_DIR;
    mkdirSync(shotDir, { recursive: true });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/harness.html');

    const hostRoot = page.locator('[data-host="obsidian"]');
    await expect(hostRoot).toBeVisible();

    // D-160: h1 heading & permanent live status region
    await expect(page.locator('h1.ms-obsidian-title')).toHaveText('MathSlot');
    const liveStatus = page.locator('.ms-obsidian-status');
    await expect(liveStatus).toHaveAttribute('role', 'status');
    await expect(liveStatus).toHaveAttribute('aria-live', 'polite');
    await expect(liveStatus).toHaveAttribute('aria-atomic', 'true');

    // D-161: ariaSnapshot check
    await expect(hostRoot).toMatchAriaSnapshot(`
      - banner:
        - heading "MathSlot" [level=1]
      - status
      - region "MathSlot 公式编辑器":
        - textbox "MathSlot 公式编辑器"
      - region "公式实时预览":
        - toolbar "预览缩放与导出工具栏"
        - region "数学公式 SVG 预览区域"
      - region "错误与诊断面板"
      - region "MathSlot 命令与预置调色板":
        - tablist "调色板模式":
          - tab "命令目录 (121)" [selected]
          - tab "预置公式 (88)"
          - tab "片段 (0)"
        - searchbox "搜索命令"
        - tabpanel "命令目录 (121)":
          - tablist "命令分类":
            - tab "全部" [selected]
    `);

    // D-157: hidden <input type="file"> excluded from Tab order
    const fileAttrs = await page.getByTestId('obsidian-config-file-input').evaluate((el) => ({
      tabIndex: (el as HTMLInputElement).tabIndex,
      ariaHidden: el.getAttribute('aria-hidden'),
    }));
    expect(fileAttrs.tabIndex).toBe(-1);
    expect(fileAttrs.ariaHidden).toBe('true');

    // D-159: .ms-obsidian-btn shows explicit 2px solid focus-visible ring
    const navBtn = page.getByTestId('obsidian-nav-btn');
    await navBtn.focus();
    await page.keyboard.press('Tab');
    const importBtn = page.getByTestId('obsidian-import-btn');
    await expect(importBtn).toBeFocused();
    const focusOutline = await importBtn.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: s.outlineWidth };
    });
    expect(focusOutline.style).toBe('solid');
    expect(focusOutline.width).toBe('2px');

    // D-160: PalettePanel mode tablist roving tabindex & ArrowRight/Home
    const cmdTab = page.locator('[data-palette-mode="commands"]');
    const presetTab = page.locator('[data-palette-mode="presets"]');
    await cmdTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(presetTab).toHaveAttribute('aria-selected', 'true');
    await expect(presetTab).toBeFocused();
    await page.keyboard.press('Home');
    await expect(cmdTab).toHaveAttribute('aria-selected', 'true');

    // D-156: ImportModal focus entry, trap, Escape -> ImportAcknowledge, and focus restore
    await importBtn.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('import-modal')).toBeVisible();
    const importFocusedInside = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[data-testid="import-modal"]')),
    );
    expect(importFocusedInside).toBe(true);

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Shift+Tab');
      const inside = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[data-testid="import-modal"]')),
      );
      expect(inside).toBe(true);
    }

    await page.getByTestId('import-latex-input').fill('1 + 2}');
    await page.getByTestId('import-submit-btn').click();
    await expect(page.getByTestId('import-blocked-banner')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('import-modal')).toHaveCount(0);
    await expect(importBtn).toBeFocused();

    // D-156 & D-160: Obsidian SettingsPanel wrapped in role="dialog" aria-modal="true", focus trap, radiogroup Arrow keys, Escape isolation, focus restore
    const settingsBtn = page.getByTestId('obsidian-settings-btn');
    await settingsBtn.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible();
    const settingsFocusedInside = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"][aria-modal="true"]')),
    );
    expect(settingsFocusedInside).toBe(true);

    await page.screenshot({
      path: resolve(shotDir, 'obsidian-a11y-light-settings-dialog.png'),
      fullPage: false,
    });

    // Capture Escape isolation inside SettingsPanel
    await page.getByTestId('shortcut-capture-open_settings').click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('shortcut-capture-open_settings')).toHaveAttribute('aria-pressed', 'false');

    // Light theme contrast check on SettingsPanel warning/danger elements
    const measureContrast = async (selectors: string[]) => {
      return page.evaluate((sels) => {
        const parseRgba = (raw: string): [number, number, number, number] => {
          const srgb = raw.match(/color\(srgb\s+([^/)]+)(?:\/\s*([^)]+))?\)/);
          if (srgb) {
            const vals = srgb[1]!
              .trim()
              .split(/\s+/)
              .map((p) => Number.parseFloat(p) * 255);
            const alpha = srgb[2] ? Number.parseFloat(srgb[2].trim()) : 1;
            return [vals[0] ?? 0, vals[1] ?? 0, vals[2] ?? 0, Number.isFinite(alpha) ? alpha : 1];
          }
          const m = raw.match(/rgba?\(([^)]+)\)/);
          if (!m) return [0, 0, 0, 0];
          const parts = m[1]!.split(',').map((p) => Number.parseFloat(p.trim()));
          return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
        };
        const composite = (
          fg: [number, number, number, number],
          bg: [number, number, number],
        ): [number, number, number] => {
          const a = fg[3];
          return [
            fg[0] * a + bg[0] * (1 - a),
            fg[1] * a + bg[1] * (1 - a),
            fg[2] * a + bg[2] * (1 - a),
          ];
        };
        const resolveEffectiveBg = (el: Element): [number, number, number] => {
          const chain: Array<[number, number, number, number]> = [];
          let cur: Element | null = el;
          while (cur) {
            chain.push(parseRgba(getComputedStyle(cur).backgroundColor));
            cur = cur.parentElement;
          }
          let acc: [number, number, number] = [255, 255, 255];
          for (let i = chain.length - 1; i >= 0; i -= 1) {
            const c = chain[i]!;
            if (c[3] > 0) acc = composite(c, acc);
          }
          return acc;
        };
        const lum = (rgb: [number, number, number]) => {
          const ch = (v: number) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
        };
        return sels.map((sel) => {
          const el = document.querySelector(sel);
          if (!el) return { sel, missing: true, ratio: 0 };
          const style = getComputedStyle(el);
          const bg = resolveEffectiveBg(el);
          const fgRaw = parseRgba(style.color);
          const fg = composite(fgRaw, bg);
          const l1 = lum(fg);
          const l2 = lum(bg);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          return { sel, missing: false, ratio: Number(ratio.toFixed(2)) };
        });
      }, selectors);
    };

    // Make settings dirty to reveal .ms-state-pill-warn, then measure Light ratios
    await page.getByTestId('theme-option-light').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('theme-option-dark')).toHaveAttribute('aria-checked', 'true');
    const lightSettingsRatios = await measureContrast([
      '.ms-state-pill-warn',
      '[data-testid="settings-reset-trigger"]',
    ]);
    for (const item of lightSettingsRatios) {
      expect(item.missing, `Missing ${item.sel}`).toBe(false);
      expect(item.ratio, `Low contrast on Obsidian Light ${item.sel}: ${item.ratio}`).toBeGreaterThanOrEqual(4.5);
    }

    // Save dark theme and close via Escape -> restores focus to settingsBtn
    await page.getByTestId('settings-save-btn').click();
    await expect(hostRoot).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(settingsBtn).toBeFocused();

    // Check CM6 placeholder contrast in Dark theme and focus Palette tab for screenshot
    await cmdTab.focus();
    await page.screenshot({
      path: resolve(shotDir, 'obsidian-a11y-dark-palette-focus.png'),
      fullPage: false,
    });
    const darkWorkspaceRatios = await measureContrast(['.cm-placeholder', '.ms-diag-severity']);
    for (const item of darkWorkspaceRatios) {
      expect(item.missing, `Missing ${item.sel}`).toBe(false);
      expect(item.ratio, `Low contrast on Obsidian Dark ${item.sel}: ${item.ratio}`).toBeGreaterThanOrEqual(4.5);
    }

    // Check reducedMotion: 'reduce'
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const cardDuration = await page
      .locator('.ms-command-card')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(cardDuration).toBe('0s');

    // Switch back to Light + check placeholder + render failure degraded badge + error status contrast in Light
    await page.goto('/harness.html?failRender=1');
    const lightPlaceholderRatios = await measureContrast(['.cm-placeholder']);
    for (const item of lightPlaceholderRatios) {
      expect(item.missing, `Missing ${item.sel}`).toBe(false);
      expect(item.ratio, `Low contrast on Obsidian Light ${item.sel}: ${item.ratio}`).toBeGreaterThanOrEqual(4.5);
    }

    await page.getByTestId('obsidian-import-btn').click();
    await page.getByTestId('import-latex-input').fill('\\frac{1}{}');
    await page.getByTestId('import-submit-btn').click();
    await page.getByTestId('import-apply-btn').click();
    await expect(page.getByTestId('degraded-badge')).toBeVisible();

    await page.getByTestId('preview-export-btn').click();
    await expect(liveStatus).toHaveAttribute('data-severity', 'Error');

    const lightWorkspaceRatios = await measureContrast([
      '.ms-degraded-badge',
      '.ms-diag-severity',
      '.ms-slot-empty',
      '.ms-obsidian-status',
    ]);
    for (const item of lightWorkspaceRatios) {
      expect(item.missing, `Missing ${item.sel}`).toBe(false);
      expect(item.ratio, `Low contrast on Obsidian Light ${item.sel}: ${item.ratio}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
