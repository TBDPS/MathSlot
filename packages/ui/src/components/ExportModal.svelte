<script lang="ts">
  import { untrack } from 'svelte';
  import { formatExport, type DelimiterStyle } from '@mathslot/core';
  import { renderLatexPreview } from '../katexRenderer';
  import {
    latexToMathML,
    renderLatexToPng,
    renderLatexToSvg,
    triggerBrowserDownload,
    type ExportBackground,
  } from '../exportUtils';

  interface Props {
    latex: string;
    delimiter: DelimiterStyle;
    isDark: boolean;
    onCopyText: (text: string) => Promise<void>;
    onCopyImagePng?: (rgba: Uint8Array, width: number, height: number, blob: Blob) => Promise<void>;
    onSaveExportFile?: (filename: string, bytes: Uint8Array) => Promise<string>;
    onOpenDownloadsDir?: () => Promise<void>;
    onNotify: (msg: string) => void;
    onClose: () => void;
  }

  let {
    latex,
    delimiter,
    isDark,
    onCopyText,
    onCopyImagePng,
    onSaveExportFile,
    onOpenDownloadsDir,
    onNotify,
    onClose,
  }: Props = $props();

  // Default to white background in dark theme so exported/copied images remain legible on Word/PPT/Docs!
  let background = $state<ExportBackground>(untrack(() => (isDark ? 'light' : 'transparent')));
  let pngScale = $state<2 | 3 | 4>(3);
  let busy = $state(false);
  let lastSavedPath = $state('');

  const previewHtml = $derived(renderLatexPreview(latex, true));
  const previewDark = $derived(
    background === 'dark' || (background === 'transparent' && isDark),
  );

  function timestampSlug(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `mathslot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  async function saveBytes(filename: string, bytes: Uint8Array, mime: string): Promise<void> {
    if (onSaveExportFile) {
      const saved = await onSaveExportFile(filename, bytes);
      lastSavedPath = saved;
      onNotify(`已导出：${filename}`);
      return;
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    triggerBrowserDownload(filename, copy, mime);
    onNotify(`已开始下载：${filename}`);
  }

  async function copyPng(): Promise<void> {
    if (busy || !latex.trim()) return;
    busy = true;
    try {
      const rendered = await renderLatexToPng(latex, {
        background,
        dark: previewDark,
        scale: pngScale,
      });
      if (onCopyImagePng) {
        await onCopyImagePng(rendered.rgba, rendered.width, rendered.height, rendered.blob);
      } else if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': rendered.blob })]);
      } else {
        throw new Error('Clipboard image write unsupported');
      }
      const actualScaleLabel =
        rendered.scale < pngScale - 0.05
          ? `${rendered.scale.toFixed(1)}×（已按 8192px 画布上限自适应缩放）`
          : `${pngScale}×`;
      onNotify(`已复制 ${actualScaleLabel} 高清 PNG 图片`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onNotify(`PNG 复制失败：${msg}`);
    } finally {
      busy = false;
    }
  }

  async function copySvg(): Promise<void> {
    if (busy || !latex.trim()) return;
    busy = true;
    try {
      const rendered = await renderLatexToSvg(latex, {
        background,
        dark: previewDark,
        embedFonts: true,
      });
      await onCopyText(rendered.svg);
      onNotify('已复制纯矢量 SVG 代码');
    } catch {
      onNotify('SVG 生成失败');
    } finally {
      busy = false;
    }
  }

  async function copyMathML(): Promise<void> {
    if (busy || !latex.trim()) return;
    busy = true;
    try {
      const mml = latexToMathML(latex);
      await onCopyText(mml);
      onNotify('已复制 Word 公式 (MathML)');
    } catch {
      onNotify('Word 公式 (MathML) 复制失败');
    } finally {
      busy = false;
    }
  }

  async function copyLatex(): Promise<void> {
    if (busy || !latex.trim()) return;
    busy = true;
    try {
      await onCopyText(formatExport(latex, delimiter));
      onNotify('已复制 LaTeX');
    } catch {
      onNotify('复制 LaTeX 失败');
    } finally {
      busy = false;
    }
  }

  async function exportPng(): Promise<void> {
    if (busy || !latex.trim()) return;
    busy = true;
    try {
      const rendered = await renderLatexToPng(latex, {
        background,
        dark: previewDark,
        scale: pngScale,
      });
      await saveBytes(`${timestampSlug()}.png`, rendered.bytes, 'image/png');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onNotify(`导出 PNG 失败：${msg}`);
    } finally {
      busy = false;
    }
  }

  async function exportSvg(): Promise<void> {
    if (busy || !latex.trim()) return;
    busy = true;
    try {
      const rendered = await renderLatexToSvg(latex, {
        background,
        dark: previewDark,
        embedFonts: true,
      });
      const bytes = new TextEncoder().encode(rendered.svg);
      await saveBytes(`${timestampSlug()}.svg`, bytes, 'image/svg+xml;charset=utf-8');
    } catch {
      onNotify('导出 SVG 失败');
    } finally {
      busy = false;
    }
  }

  async function exportTex(): Promise<void> {
    if (busy || !latex.trim()) return;
    busy = true;
    try {
      const bytes = new TextEncoder().encode(formatExport(latex, delimiter) + '\n');
      await saveBytes(`${timestampSlug()}.tex`, bytes, 'text/plain;charset=utf-8');
    } catch {
      onNotify('导出 TeX 文件失败');
    } finally {
      busy = false;
    }
  }

  async function exportMathML(): Promise<void> {
    if (busy || !latex.trim()) return;
    busy = true;
    try {
      const bytes = new TextEncoder().encode(latexToMathML(latex) + '\n');
      await saveBytes(`${timestampSlug()}.mml`, bytes, 'application/mathml+xml;charset=utf-8');
    } catch {
      onNotify('导出 MathML 文件失败');
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }}
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label="导出与复制公式">
    <div class="modal-head">
      <span>导出与复制公式</span>
      <button type="button" class="close-btn" onclick={onClose} aria-label="关闭">✕</button>
    </div>

    <div class="modal-body">
      <div
        class="preview-stage"
        class:bg-transparent={background === 'transparent'}
        class:bg-light={background === 'light'}
        class:bg-dark={background === 'dark'}
        class:fg-dark={previewDark}
      >
        <div class="preview-math">{@html previewHtml}</div>
      </div>

      <div class="opts-row">
        <div class="opt-group">
          <span class="opt-label">背景</span>
          <div class="seg-group">
            <button type="button" class="seg-btn" class:active={background === 'transparent'} onclick={() => (background = 'transparent')}>透明</button>
            <button type="button" class="seg-btn" class:active={background === 'light'} onclick={() => (background = 'light')}>白底</button>
            <button type="button" class="seg-btn" class:active={background === 'dark'} onclick={() => (background = 'dark')}>深色</button>
          </div>
        </div>

        <div class="opt-group">
          <span class="opt-label">PNG 清晰度</span>
          <div class="seg-group">
            <button type="button" class="seg-btn" class:active={pngScale === 2} onclick={() => (pngScale = 2)}>2×</button>
            <button type="button" class="seg-btn" class:active={pngScale === 3} onclick={() => (pngScale = 3)}>3×</button>
            <button type="button" class="seg-btn" class:active={pngScale === 4} onclick={() => (pngScale = 4)}>4×</button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="sec-title">复制到剪贴板</div>
        <div class="action-grid">
          <button type="button" class="action-btn primary" disabled={busy} onclick={() => void copyPng()}>
            复制 PNG 图片
          </button>
          <button type="button" class="action-btn" disabled={busy} onclick={() => void copySvg()}>
            复制 SVG 矢量
          </button>
          <button type="button" class="action-btn" disabled={busy} onclick={() => void copyMathML()}>
            复制 Word (MathML)
          </button>
          <button type="button" class="action-btn" disabled={busy} onclick={() => void copyLatex()}>
            复制 LaTeX
          </button>
        </div>
      </div>

      <div class="section">
        <div class="sec-title">导出保存为文件</div>
        <div class="action-grid">
          <button type="button" class="action-btn" disabled={busy} onclick={() => void exportPng()}>
            保存 .png
          </button>
          <button type="button" class="action-btn" disabled={busy} onclick={() => void exportSvg()}>
            保存 .svg
          </button>
          <button type="button" class="action-btn" disabled={busy} onclick={() => void exportTex()}>
            保存 .tex
          </button>
          <button type="button" class="action-btn" disabled={busy} onclick={() => void exportMathML()}>
            保存 .mml
          </button>
        </div>
      </div>

      {#if lastSavedPath}
        <div class="saved-banner">
          <span class="saved-path" title={lastSavedPath}>已保存：{lastSavedPath}</span>
          {#if onOpenDownloadsDir}
            <button type="button" class="open-dir-btn" onclick={() => void onOpenDownloadsDir?.()}>
              打开目录
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.36);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    z-index: 65;
  }

  .modal {
    width: min(560px, 100%);
    max-height: min(92%, 600px);
    background: var(--ms-surface);
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-lg);
    box-shadow: var(--ms-shadow-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ms-border-subtle);
    font-size: 14px;
    font-weight: 600;
    color: var(--ms-fg);
    flex-shrink: 0;
  }

  .close-btn {
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--ms-fg-muted);
    cursor: pointer;
    padding: 0;
  }

  .close-btn:hover {
    background: var(--ms-surface-muted);
    color: var(--ms-fg);
  }

  .modal-body {
    padding: 14px 16px 16px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .preview-stage {
    min-height: 92px;
    max-height: 180px;
    padding: 16px 20px;
    border-radius: var(--ms-radius-md);
    border: 1px solid var(--ms-border);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    color: #111318;
  }

  .preview-stage.fg-dark {
    color: #f0f2f6;
  }

  .preview-stage.bg-transparent {
    background-image:
      linear-gradient(45deg, rgba(128, 128, 128, 0.12) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(128, 128, 128, 0.12) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgba(128, 128, 128, 0.12) 75%),
      linear-gradient(-45deg, transparent 75%, rgba(128, 128, 128, 0.12) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }

  .preview-stage.bg-light {
    background: #ffffff;
  }

  .preview-stage.bg-dark {
    background: #12151c;
  }

  .preview-math {
    font-size: 18px;
    line-height: 1.4;
  }

  .opts-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .opt-group {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .opt-label {
    font-size: 12px;
    color: var(--ms-fg-muted);
    font-weight: 500;
  }

  .seg-group {
    display: inline-flex;
    padding: 2px;
    border-radius: 7px;
    background: var(--ms-chrome);
    border: 1px solid var(--ms-border);
    gap: 2px;
  }

  .seg-btn {
    height: 24px;
    padding: 0 9px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--ms-fg-muted);
    font-size: 11.5px;
    cursor: pointer;
  }

  .seg-btn.active {
    background: var(--ms-surface);
    color: var(--ms-accent);
    font-weight: 600;
    box-shadow: var(--ms-shadow-sm);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .sec-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--ms-fg-muted);
  }

  .action-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
  }

  .action-btn {
    height: 34px;
    padding: 0 12px;
    border: 1px solid var(--ms-border);
    border-radius: 8px;
    background: var(--ms-bg);
    color: var(--ms-fg);
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: border-color 90ms ease, background-color 90ms ease, color 90ms ease;
  }

  .action-btn:hover:not(:disabled) {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
    background: var(--ms-accent-soft);
  }

  .action-btn.primary {
    border-color: var(--ms-accent);
    background: var(--ms-accent);
    color: var(--ms-accent-fg);
  }

  .action-btn.primary:hover:not(:disabled) {
    background: var(--ms-accent-hover);
    color: var(--ms-accent-fg);
  }

  .action-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .saved-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--ms-accent-soft);
    border: 1px solid color-mix(in srgb, var(--ms-accent) 28%, transparent);
    font-size: 11.5px;
    color: var(--ms-fg);
  }

  .saved-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--ms-font-mono);
  }

  .open-dir-btn {
    height: 24px;
    padding: 0 9px;
    border: 1px solid var(--ms-accent);
    border-radius: 6px;
    background: var(--ms-surface);
    color: var(--ms-accent);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
  }
</style>
