import katex from 'katex';

/**
 * Converts canonical LaTeX into clean standalone MathML (`<math xmlns="...">...</math>`).
 * Directly pastes into Microsoft Word, LibreOffice Writer, and Notion as a native editable equation!
 */
export function latexToMathML(latex: string): string {
  const clean = latex.trim();
  if (!clean) return '';
  const html = katex.renderToString(clean, {
    displayMode: true,
    output: 'mathml',
    throwOnError: false,
    strict: false,
  });
  const match = html.match(/<math[\s\S]*<\/math>/);
  return match ? match[0] : html;
}

export interface RenderedPng {
  blob: Blob;
  rgba: Uint8Array;
  width: number;
  height: number;
}

function collectKatexStyles(): string {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const cssRules = sheet.cssRules;
      for (const r of Array.from(cssRules)) {
        const text = r.cssText;
        if (text.includes('katex') || text.includes('@font-face')) {
          rules.push(text);
        }
      }
    } catch {
      // Cross-origin stylesheet, skip safely
    }
  }
  return rules.join('\n');
}

/**
 * Renders a LaTeX formula into a crisp 3x retina PNG + raw RGBA buffer for native OS clipboard copy.
 */
export async function renderLatexToPng(
  latex: string,
  options: { dark?: boolean; scale?: number } = {},
): Promise<RenderedPng> {
  const clean = latex.trim();
  const scale = options.scale ?? 3;
  const fg = options.dark ? '#f0f2f6' : '#111318';

  const html = katex.renderToString(clean, {
    displayMode: true,
    throwOnError: false,
    strict: false,
  });

  // Measure rendered HTML dimensions in an offscreen node
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.left = '-99999px';
  probe.style.top = '0';
  probe.style.display = 'inline-block';
  probe.style.padding = '16px 24px';
  probe.style.fontSize = '28px';
  probe.style.color = fg;
  probe.innerHTML = html;
  document.body.appendChild(probe);

  const rect = probe.getBoundingClientRect();
  const widthCss = Math.max(64, Math.ceil(rect.width));
  const heightCss = Math.max(40, Math.ceil(rect.height));
  probe.remove();

  const katexCss = collectKatexStyles();
  const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${widthCss}" height="${heightCss}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="display:inline-flex;align-items:center;justify-content:center;width:${widthCss}px;height:${heightCss}px;font-size:28px;color:${fg};box-sizing:border-box;">
          <style>${katexCss}\n.katex-display{margin:0 !important;}</style>
          ${html}
        </div>
      </foreignObject>
    </svg>
  `;

  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('SVG rasterization failed'));
    img.src = svgUrl;
  });

  const width = Math.round(widthCss * scale);
  const height = Math.round(heightCss * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, widthCss, heightCss);

  const imageData = ctx.getImageData(0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
  });

  return {
    blob,
    rgba: new Uint8Array(imageData.data.buffer),
    width,
    height,
  };
}
