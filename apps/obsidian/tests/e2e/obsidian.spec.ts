import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type * as PlaywrightTest from '../../../desktop/node_modules/@playwright/test/index';

const require = createRequire(import.meta.url);
const { expect, test } = require('../../../desktop/node_modules/@playwright/test/index.js') as typeof PlaywrightTest;

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
});
