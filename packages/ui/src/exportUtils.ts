import katex from 'katex';

export type ExportBackground = 'transparent' | 'light' | 'dark';

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
  bytes: Uint8Array;
  rgba: Uint8Array;
  width: number;
  height: number;
}

export interface RenderedSvg {
  svg: string;
  width: number;
  height: number;
}

interface SceneRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}

interface SceneText {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  fill: string;
}

interface SceneSvgShape {
  kind: 'path' | 'rect' | 'line';
  d?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

interface SceneSvg {
  x: number;
  y: number;
  width: number;
  height: number;
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
  preserveAspectRatio: string;
  shapes: SceneSvgShape[];
}

interface VectorScene {
  width: number;
  height: number;
  bgColor: string | null;
  fgColor: string;
  rects: SceneRect[];
  texts: SceneText[];
  svgs: SceneSvg[];
  usedFamilies: Set<string>;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isTransparent(color: string | null | undefined): boolean {
  if (!color) return true;
  const c = color.trim().toLowerCase();
  return c === 'transparent' || c === 'none' || c === 'rgba(0, 0, 0, 0)';
}

function resolveColors(bg: ExportBackground, dark?: boolean): { bgColor: string | null; fgColor: string } {
  if (bg === 'dark') return { bgColor: '#12151c', fgColor: '#f0f2f6' };
  if (bg === 'light') return { bgColor: '#ffffff', fgColor: '#111318' };
  return { bgColor: null, fgColor: dark ? '#f0f2f6' : '#111318' };
}

function primaryFontFamily(fontFamily: string): string {
  const first = fontFamily.split(',')[0] ?? '';
  return first.replace(/['"]/g, '').trim();
}

/**
 * Extracts a pure-vector scene (rects + native SVG paths + positioned text runs) directly
 * from a live rendered KaTeX DOM tree. Zero `<foreignObject>`, zero canvas tainting on WebKitGTK!
 */
async function extractVectorScene(
  latex: string,
  options: { background?: ExportBackground; dark?: boolean; fontSize?: number } = {},
): Promise<VectorScene> {
  const clean = latex.trim();
  const bg = options.background ?? 'transparent';
  const fontSize = options.fontSize ?? 34;
  const { bgColor, fgColor } = resolveColors(bg, options.dark);

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed even if font readiness rejects
    }
  }

  const html = katex.renderToString(clean, {
    displayMode: true,
    output: 'html',
    throwOnError: false,
    strict: false,
  });

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-99999px';
  host.style.top = '0';
  host.style.pointerEvents = 'none';
  host.style.display = 'inline-block';
  host.style.fontSize = `${fontSize}px`;
  host.style.lineHeight = '1.2';
  host.style.color = fgColor;
  host.style.margin = '0';
  host.style.padding = '0';
  host.innerHTML = html;
  document.body.appendChild(host);

  try {
    const katexHtml = (host.querySelector('.katex-html') as HTMLElement | null) ?? host;
    const rawRects: SceneRect[] = [];
    const rawTexts: SceneText[] = [];
    const rawSvgs: SceneSvg[] = [];
    const usedFamilies = new Set<string>();

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const expand = (x: number, y: number, w: number, h: number): void => {
      if (w <= 0 || h <= 0) return;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    };

    // 1. Collect rules, fraction bars, underlines, overlines, and visible backgrounds
    const allEls = katexHtml.querySelectorAll('*');
    for (const node of allEls) {
      if (node instanceof SVGElement) continue;
      if (!(node instanceof HTMLElement)) continue;
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const r = node.getBoundingClientRect();
      if (r.width <= 0.1 && r.height <= 0.1) continue;

      if (!isTransparent(cs.backgroundColor) && r.width > 0.2 && r.height > 0.2) {
        rawRects.push({ x: r.left, y: r.top, width: r.width, height: r.height, fill: cs.backgroundColor });
        expand(r.left, r.top, r.width, r.height);
      }

      const bbw = parseFloat(cs.borderBottomWidth) || 0;
      if (bbw > 0 && cs.borderBottomStyle !== 'none' && !isTransparent(cs.borderBottomColor) && r.width > 0.2) {
        rawRects.push({ x: r.left, y: r.bottom - bbw, width: r.width, height: bbw, fill: cs.borderBottomColor });
        expand(r.left, r.bottom - bbw, r.width, bbw);
      }
      const btw = parseFloat(cs.borderTopWidth) || 0;
      if (btw > 0 && cs.borderTopStyle !== 'none' && !isTransparent(cs.borderTopColor) && r.width > 0.2) {
        rawRects.push({ x: r.left, y: r.top, width: r.width, height: btw, fill: cs.borderTopColor });
        expand(r.left, r.top, r.width, btw);
      }
      const blw = parseFloat(cs.borderLeftWidth) || 0;
      if (blw > 0 && cs.borderLeftStyle !== 'none' && !isTransparent(cs.borderLeftColor) && r.height > 0.2) {
        rawRects.push({ x: r.left, y: r.top, width: blw, height: r.height, fill: cs.borderLeftColor });
        expand(r.left, r.top, blw, r.height);
      }
      const brw = parseFloat(cs.borderRightWidth) || 0;
      if (brw > 0 && cs.borderRightStyle !== 'none' && !isTransparent(cs.borderRightColor) && r.height > 0.2) {
        rawRects.push({ x: r.right - brw, y: r.top, width: brw, height: r.height, fill: cs.borderRightColor });
        expand(r.right - brw, r.top, brw, r.height);
      }
    }

    // 2. Collect KaTeX native inline `<svg>` shapes (radicals, stretchy brackets, matrix delimiters, overbraces)
    const svgEls = katexHtml.querySelectorAll('svg');
    for (const svg of svgEls) {
      const cs = getComputedStyle(svg);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const r = svg.getBoundingClientRect();
      if (r.width <= 0.2 || r.height <= 0.2) continue;

      const vbAttr = svg.getAttribute('viewBox') ?? '';
      const vbParts = vbAttr.trim().split(/[\s,]+/).map(Number);
      const vbX = vbParts.length === 4 && Number.isFinite(vbParts[0]) ? vbParts[0] : 0;
      const vbY = vbParts.length === 4 && Number.isFinite(vbParts[1]) ? vbParts[1] : 0;
      const vbW = vbParts.length === 4 && vbParts[2] > 0 ? vbParts[2] : r.width;
      const vbH = vbParts.length === 4 && vbParts[3] > 0 ? vbParts[3] : r.height;
      const preserveAspectRatio = svg.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet';
      const svgColor = cs.color || fgColor;

      const shapes: SceneSvgShape[] = [];
      for (const child of svg.querySelectorAll('path, rect, line')) {
        const ccs = getComputedStyle(child);
        const rawFill = child.getAttribute('fill') ?? ccs.fill;
        const fill = !rawFill || rawFill === 'currentColor' ? svgColor : rawFill;
        const rawStroke = child.getAttribute('stroke') ?? ccs.stroke;
        const stroke = rawStroke === 'currentColor' ? svgColor : rawStroke || 'none';
        const strokeWidth = parseFloat(child.getAttribute('stroke-width') ?? ccs.strokeWidth) || 0;
        const tag = child.tagName.toLowerCase();
        if (tag === 'path') {
          const d = child.getAttribute('d');
          if (d) shapes.push({ kind: 'path', d, fill, stroke, strokeWidth });
        } else if (tag === 'rect') {
          shapes.push({
            kind: 'rect',
            x: parseFloat(child.getAttribute('x') ?? '0') || 0,
            y: parseFloat(child.getAttribute('y') ?? '0') || 0,
            w: parseFloat(child.getAttribute('width') ?? '0') || 0,
            h: parseFloat(child.getAttribute('height') ?? '0') || 0,
            fill,
            stroke,
            strokeWidth,
          });
        } else if (tag === 'line') {
          shapes.push({
            kind: 'line',
            x1: parseFloat(child.getAttribute('x1') ?? '0') || 0,
            y1: parseFloat(child.getAttribute('y1') ?? '0') || 0,
            x2: parseFloat(child.getAttribute('x2') ?? '0') || 0,
            y2: parseFloat(child.getAttribute('y2') ?? '0') || 0,
            fill: 'none',
            stroke: isTransparent(stroke) ? svgColor : stroke,
            strokeWidth: strokeWidth || 1,
          });
        }
      }

      if (shapes.length > 0) {
        rawSvgs.push({
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
          vbX,
          vbY,
          vbW,
          vbH,
          preserveAspectRatio,
          shapes,
        });
        expand(r.left, r.top, r.width, r.height);
      }
    }

    // 3. Collect every visible text glyph run using exact Range rects
    const walker = document.createTreeWalker(katexHtml, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let cur = walker.nextNode();
    while (cur) {
      const parent = cur.parentElement;
      const rawText = cur.textContent ?? '';
      const cleaned = rawText.replace(/\u200b/g, '');
      if (parent && cleaned.trim().length > 0 && !parent.closest('svg') && !parent.closest('.katex-mathml')) {
        const cs = getComputedStyle(parent);
        const fSize = parseFloat(cs.fontSize) || 0;
        if (cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0 && fSize > 0.5) {
          range.selectNodeContents(cur);
          const r = range.getBoundingClientRect();
          if (r.width > 0.1 && r.height > 0.1) {
            const fam = primaryFontFamily(cs.fontFamily);
            if (fam) usedFamilies.add(fam);
            rawTexts.push({
              text: cleaned,
              x: r.left,
              y: r.top,
              width: r.width,
              height: r.height,
              fontFamily: cs.fontFamily,
              fontSize: fSize,
              fontWeight: cs.fontWeight,
              fontStyle: cs.fontStyle,
              fill: cs.color || fgColor,
            });
            expand(r.left, r.top, r.width, r.height);
          }
        }
      }
      cur = walker.nextNode();
    }

    if (!Number.isFinite(minX)) {
      const r = katexHtml.getBoundingClientRect();
      minX = r.left;
      minY = r.top;
      maxX = r.right;
      maxY = r.bottom;
    }

    const padX = 22;
    const padY = 18;
    const originX = minX - padX;
    const originY = minY - padY;
    const width = Math.max(48, Math.ceil(maxX - minX + padX * 2));
    const height = Math.max(36, Math.ceil(maxY - minY + padY * 2));

    return {
      width,
      height,
      bgColor,
      fgColor,
      usedFamilies,
      rects: rawRects.map((it) => ({ ...it, x: it.x - originX, y: it.y - originY })),
      svgs: rawSvgs.map((it) => ({ ...it, x: it.x - originX, y: it.y - originY })),
      texts: rawTexts.map((it) => ({ ...it, x: it.x - originX, y: it.y - originY })),
    };
  } finally {
    host.remove();
  }
}

/** Computes exact SVG preserveAspectRatio scale + translation inside target box (w, h). */
function computeSvgViewportTransform(svg: SceneSvg): {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
} {
  const parts = svg.preserveAspectRatio.trim().split(/\s+/);
  const align = parts[0] ?? 'xMidYMid';
  const meetOrSlice = parts[1] ?? 'meet';

  if (align === 'none') {
    const sx = svg.width / svg.vbW;
    const sy = svg.height / svg.vbH;
    return { sx, sy, tx: -svg.vbX * sx, ty: -svg.vbY * sy };
  }

  const ratioX = svg.width / svg.vbW;
  const ratioY = svg.height / svg.vbH;
  const s = meetOrSlice === 'slice' ? Math.max(ratioX, ratioY) : Math.min(ratioX, ratioY);
  const scaledW = svg.vbW * s;
  const scaledH = svg.vbH * s;

  let ox = 0;
  if (align.startsWith('xMid')) ox = (svg.width - scaledW) / 2;
  else if (align.startsWith('xMax')) ox = svg.width - scaledW;

  let oy = 0;
  if (align.includes('YMid')) oy = (svg.height - scaledH) / 2;
  else if (align.includes('YMax')) oy = svg.height - scaledH;

  return {
    sx: s,
    sy: s,
    tx: ox - svg.vbX * s,
    ty: oy - svg.vbY * s,
  };
}

/** Computes precise Canvas/SVG alphabetic baseline inside a DOM Range bounding box. */
function computeBaselineY(ctx: CanvasRenderingContext2D, t: SceneText): number {
  ctx.font = `${t.fontStyle} ${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
  const metrics = ctx.measureText(t.text);
  const fAsc = metrics.fontBoundingBoxAscent;
  const fDesc = metrics.fontBoundingBoxDescent;
  if (typeof fAsc === 'number' && typeof fDesc === 'number' && fAsc + fDesc > 0.5) {
    // Center the font em-box vertically inside the DOM Range box
    const extra = (t.height - (fAsc + fDesc)) / 2;
    return t.y + extra + fAsc;
  }
  return t.y + t.height * 0.78;
}

/**
 * Renders a LaTeX formula into a crisp retina PNG + raw RGBA buffer using pure Canvas 2D + Path2D.
 * Zero `<foreignObject>`, zero canvas tainting on Linux WebKitGTK / macOS WebKit / Windows / Obsidian!
 */
export async function renderLatexToPng(
  latex: string,
  options: { dark?: boolean; background?: ExportBackground; scale?: number; fontSize?: number } = {},
): Promise<RenderedPng> {
  const scale = options.scale ?? 3;
  const scene = await extractVectorScene(latex, {
    background: options.background ?? 'transparent',
    dark: options.dark,
    fontSize: options.fontSize ?? 34,
  });

  const width = Math.round(scene.width * scale);
  const height = Math.round(scene.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  ctx.scale(scale, scale);

  if (scene.bgColor) {
    ctx.fillStyle = scene.bgColor;
    ctx.fillRect(0, 0, scene.width, scene.height);
  }

  // 1. Draw fraction bars, radical lines, rules
  for (const r of scene.rects) {
    ctx.fillStyle = r.fill;
    ctx.fillRect(r.x, r.y, r.width, r.height);
  }

  // 2. Draw KaTeX stretchy SVG paths with exact preserveAspectRatio + clip
  for (const svg of scene.svgs) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(svg.x, svg.y, svg.width, svg.height);
    ctx.clip();

    const tf = computeSvgViewportTransform(svg);
    ctx.translate(svg.x + tf.tx, svg.y + tf.ty);
    ctx.scale(tf.sx, tf.sy);

    for (const sh of svg.shapes) {
      if (sh.kind === 'path' && sh.d) {
        const path = new Path2D(sh.d);
        if (!isTransparent(sh.fill)) {
          ctx.fillStyle = sh.fill;
          ctx.fill(path);
        }
        if (!isTransparent(sh.stroke) && sh.strokeWidth > 0) {
          ctx.strokeStyle = sh.stroke;
          ctx.lineWidth = sh.strokeWidth;
          ctx.stroke(path);
        }
      } else if (sh.kind === 'rect') {
        if (!isTransparent(sh.fill)) {
          ctx.fillStyle = sh.fill;
          ctx.fillRect(sh.x ?? 0, sh.y ?? 0, sh.w ?? 0, sh.h ?? 0);
        }
      } else if (sh.kind === 'line') {
        if (!isTransparent(sh.stroke) && sh.strokeWidth > 0) {
          ctx.strokeStyle = sh.stroke;
          ctx.lineWidth = sh.strokeWidth;
          ctx.beginPath();
          ctx.moveTo(sh.x1 ?? 0, sh.y1 ?? 0);
          ctx.lineTo(sh.x2 ?? 0, sh.y2 ?? 0);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // 3. Draw every text glyph using live loaded KaTeX webfonts
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const t of scene.texts) {
    const baselineY = computeBaselineY(ctx, t);
    ctx.fillStyle = t.fill;
    ctx.fillText(t.text, t.x, baselineY);
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());

  return {
    blob,
    bytes,
    rgba: new Uint8Array(imageData.data.buffer),
    width,
    height,
  };
}

const fontDataUrlCache = new Map<string, string>();

async function inlineFontUrl(rawUrl: string): Promise<string | null> {
  if (rawUrl.startsWith('data:')) return rawUrl;
  const cached = fontDataUrlCache.get(rawUrl);
  if (cached) return cached;
  try {
    const resp = await fetch(rawUrl);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const mime = rawUrl.includes('.woff2') ? 'font/woff2' : 'font/woff';
    const dataUrl = `data:${mime};base64,${btoa(binary)}`;
    fontDataUrlCache.set(rawUrl, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

async function collectEmbeddedFontCss(usedFamilies: Set<string>): Promise<string> {
  if (usedFamilies.size === 0) return '';
  const matchedRules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const text = rule.cssText;
      const famMatch = text.match(/font-family:\s*["']?([^;"']+)["']?/i);
      const fam = famMatch?.[1]?.trim();
      if (!fam || !usedFamilies.has(fam)) continue;

      // Prefer .woff2 source, inline external URLs as base64 so exported SVG works standalone offline
      const woff2Match = text.match(/url\(["']?([^"')]+(?:\.woff2|font\/woff2[^"')]*))["']?\)/i);
      const anyUrlMatch = woff2Match ?? text.match(/url\(["']?([^"')]+)["']?\)/i);
      if (!anyUrlMatch) continue;
      const inlined = await inlineFontUrl(anyUrlMatch[1]);
      if (!inlined) continue;

      const styleMatch = text.match(/font-style:\s*([^;]+)/i);
      const weightMatch = text.match(/font-weight:\s*([^;]+)/i);
      const fStyle = styleMatch?.[1]?.trim() ?? 'normal';
      const fWeight = weightMatch?.[1]?.trim() ?? '400';
      const fmt = inlined.includes('font/woff2') ? 'woff2' : 'woff';
      matchedRules.push(
        `@font-face{font-family:"${fam}";font-style:${fStyle};font-weight:${fWeight};src:url("${inlined}") format("${fmt}");}`,
      );
    }
  }
  return matchedRules.join('\n');
}

/**
 * Renders a LaTeX formula into a pure, standalone, `<foreignObject>`-free vector SVG!
 * Embeds only the KaTeX woff2 font faces actually used by the formula so it renders crisply anywhere.
 */
export async function renderLatexToSvg(
  latex: string,
  options: { dark?: boolean; background?: ExportBackground; fontSize?: number; embedFonts?: boolean } = {},
): Promise<RenderedSvg> {
  const scene = await extractVectorScene(latex, {
    background: options.background ?? 'transparent',
    dark: options.dark,
    fontSize: options.fontSize ?? 34,
  });

  const measureCanvas = document.createElement('canvas');
  const mCtx = measureCanvas.getContext('2d');

  const fontCss = options.embedFonts !== false ? await collectEmbeddedFontCss(scene.usedFamilies) : '';
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">`,
  );
  if (fontCss) {
    parts.push(`  <defs><style><![CDATA[\n${fontCss}\n  ]]></style></defs>`);
  }
  if (scene.bgColor) {
    parts.push(`  <rect width="100%" height="100%" fill="${escapeXml(scene.bgColor)}"/>`);
  }

  for (const r of scene.rects) {
    parts.push(
      `  <rect x="${r.x.toFixed(2)}" y="${r.y.toFixed(2)}" width="${r.width.toFixed(2)}" height="${r.height.toFixed(2)}" fill="${escapeXml(r.fill)}"/>`,
    );
  }

  for (const svg of scene.svgs) {
    const inner = svg.shapes
      .map((sh) => {
        if (sh.kind === 'path' && sh.d) {
          const strokeAttr = !isTransparent(sh.stroke) && sh.strokeWidth > 0
            ? ` stroke="${escapeXml(sh.stroke)}" stroke-width="${sh.strokeWidth}"`
            : '';
          return `<path d="${escapeXml(sh.d)}" fill="${escapeXml(sh.fill)}"${strokeAttr}/>`;
        }
        if (sh.kind === 'rect') {
          return `<rect x="${sh.x ?? 0}" y="${sh.y ?? 0}" width="${sh.w ?? 0}" height="${sh.h ?? 0}" fill="${escapeXml(sh.fill)}"/>`;
        }
        if (sh.kind === 'line') {
          return `<line x1="${sh.x1 ?? 0}" y1="${sh.y1 ?? 0}" x2="${sh.x2 ?? 0}" y2="${sh.y2 ?? 0}" stroke="${escapeXml(sh.stroke)}" stroke-width="${sh.strokeWidth}"/>`;
        }
        return '';
      })
      .join('');
    parts.push(
      `  <svg x="${svg.x.toFixed(2)}" y="${svg.y.toFixed(2)}" width="${svg.width.toFixed(2)}" height="${svg.height.toFixed(2)}" viewBox="${svg.vbX} ${svg.vbY} ${svg.vbW} ${svg.vbH}" preserveAspectRatio="${escapeXml(svg.preserveAspectRatio)}">${inner}</svg>`,
    );
  }

  for (const t of scene.texts) {
    const baselineY = mCtx ? computeBaselineY(mCtx, t) : t.y + t.height * 0.78;
    const fam = primaryFontFamily(t.fontFamily) || t.fontFamily;
    parts.push(
      `  <text x="${t.x.toFixed(2)}" y="${baselineY.toFixed(2)}" font-family="${escapeXml(fam)}" font-size="${t.fontSize.toFixed(2)}" font-weight="${escapeXml(t.fontWeight)}" font-style="${escapeXml(t.fontStyle)}" fill="${escapeXml(t.fill)}">${escapeXml(t.text)}</text>`,
    );
  }

  parts.push('</svg>');
  return {
    svg: parts.join('\n'),
    width: scene.width,
    height: scene.height,
  };
}

/** Triggers a file download in browser / Obsidian environments. */
export function triggerBrowserDownload(filename: string, data: BlobPart, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
