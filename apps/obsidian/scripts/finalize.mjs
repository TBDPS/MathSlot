import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');

copyFileSync(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'));

// Strip legacy .woff and .ttf fallbacks from KaTeX CSS (keep modern .woff2) and use non-blocking font-display:swap
const cssPath = resolve(dist, 'styles.css');
if (existsSync(cssPath)) {
  const css = readFileSync(cssPath, 'utf8');
  const trimmed = css
    .replace(
      /,url\(data:font\/(?:woff|ttf);base64,[^)]+\)\s*format\("(?:woff|truetype)"\)/g,
      '',
    )
    .replace(/font-display:block/g, 'font-display:swap');
  writeFileSync(cssPath, trimmed, 'utf8');
}
console.log('Obsidian plugin finalized in apps/obsidian/dist/');
