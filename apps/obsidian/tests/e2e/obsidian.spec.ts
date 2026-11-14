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

  test('D-133 / D-134: ImportModal keeps round-trip diff open, and render failure links PreviewPanel to DiagnosticsPanel', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/harness.html?failRender=1');

    await page.getByTestId('obsidian-import-btn').click();
    await expect(page.getByTestId('import-modal')).toBeVisible();
    await page.getByTestId('import-latex-input').fill('\\frac{a}{b}');
    await page.getByTestId('import-submit-btn').click();

    // Non-blocking import keeps modal open so user can inspect round-trip report
    await expect(page.getByTestId('import-modal')).toBeVisible();
    await expect(page.getByTestId('import-roundtrip-latex')).toContainText('\\frac{a}{b}');
    await page.getByTestId('import-close-btn').click();
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
