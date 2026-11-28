import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const outDir = path.join(webDir, 'dist-offline');
const pkg = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'));

// 1. Run Vite IIFE build (classic script — works on file:// without CORS errors)
execFileSync('npx', ['vite', 'build', '--config', 'vite.offline.config.ts'], {
  cwd: webDir,
  stdio: 'inherit',
});

// 2. Locate JS & CSS emitted by Vite lib build
const jsPath = path.join(outDir, 'app.iife.js');
if (!fs.existsSync(jsPath)) {
  throw new Error(`Expected IIFE bundle at ${jsPath}`);
}

function findCssFile(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findCssFile(full);
      if (found) return found;
    } else if (entry.name.endsWith('.css')) {
      return full;
    }
  }
  return null;
}

const cssPath = findCssFile(outDir);
if (!cssPath) {
  throw new Error(`Expected CSS bundle inside ${outDir}`);
}

const cssDir = path.dirname(cssPath);
let css = fs.readFileSync(cssPath, 'utf8');

// 3. Optimize @font-face rules: keep ONLY woff2 (or woff when woff2 doesn't exist, e.g. KaTeX_Size3)
//    so the standalone offline HTML stays ~1.1 MB with 100% crisp KaTeX rendering and zero external URLs.
let keptFonts = 0;
css = css.replace(/@font-face\{[^}]*\}/g, (block) => {
  return block.replace(/src:(.+?)(?=(?:;[a-z-]+:|\}))/g, (fullMatch, srcList) => {
    const entries = [...srcList.matchAll(/url\(([^)]+)\)\s*format\((['"]?)(woff2|woff|truetype)\2\)/g)];
    if (entries.length === 0) return fullMatch;
    const preferred =
      entries.find((e) => e[3] === 'woff2') ??
      entries.find((e) => e[3] === 'woff') ??
      entries[0];
    let urlExpr = preferred[1].trim().replace(/^['"]|['"]$/g, '');
    const fmt = preferred[3];
    if (!urlExpr.startsWith('data:')) {
      const candidates = [
        path.resolve(cssDir, urlExpr),
        path.resolve(outDir, urlExpr),
        path.resolve(outDir, 'assets', path.basename(urlExpr)),
      ];
      const fontFile = candidates.find((p) => fs.existsSync(p));
      if (!fontFile) {
        throw new Error(`Could not locate font file referenced by CSS: ${urlExpr}`);
      }
      const mime = fmt === 'woff2' ? 'font/woff2' : fmt === 'woff' ? 'font/woff' : 'font/ttf';
      urlExpr = `data:${mime};base64,${fs.readFileSync(fontFile).toString('base64')}`;
    }
    keptFonts += 1;
    return `src:url(${urlExpr}) format("${fmt}")`;
  });
});

const remainingExternalUrls = [...css.matchAll(/url\((?!['"]?data:)([^)]+)\)/g)].map((m) => m[1]);
if (remainingExternalUrls.length > 0) {
  throw new Error(`Unresolved external CSS url() entries in offline build: ${remainingExternalUrls.join(', ')}`);
}

// 4. Inline SVG favicon as data URI
const iconSvg = fs.readFileSync(path.join(webDir, 'public', 'icons', 'icon.svg'), 'utf8');
const faviconDataUri = `data:image/svg+xml;base64,${Buffer.from(iconSvg, 'utf8').toString('base64')}`;

// 5. Escape </script> inside JS bundle to avoid premature script tag closure
const rawJs = fs.readFileSync(jsPath, 'utf8').replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#1e3a7a" />
    <meta name="description" content="MathSlot v${pkg.version} — 离线单文件数学公式工作台（双击即用，无需联网或本地服务器）" />
    <link rel="icon" type="image/svg+xml" href="${faviconDataUri}" />
    <title>MathSlot Studio v${pkg.version} (Offline)</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="app"></div>
    <script>${rawJs}</script>
  </body>
</html>
`;

const outputHtml = path.join(outDir, 'MathSlot-Offline.html');
fs.writeFileSync(outputHtml, html, 'utf8');

// Clean intermediate files so dist-offline contains ONLY the standalone HTML
for (const entry of fs.readdirSync(outDir)) {
  if (entry === 'MathSlot-Offline.html') continue;
  fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
}

const sizeKb = (fs.statSync(outputHtml).size / 1024).toFixed(1);
console.log(`Built standalone offline HTML: ${outputHtml} (${sizeKb} KB, ${keptFonts} fonts embedded)`);
