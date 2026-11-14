import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

function readWasmBase64(): string {
  const wasmPath = resolve(import.meta.dirname, 'src/wasm-pkg/mathslot_wasm_bg.wasm');
  if (!existsSync(wasmPath)) {
    return '';
  }
  return readFileSync(wasmPath).toString('base64');
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'e2e'),
  plugins: [svelte()],
  define: {
    __MATHSLOT_INLINE_WASM_B64__: JSON.stringify(readWasmBase64()),
  },
  resolve: {
    alias: {
      '@mathslot/ui/tokens.css': resolve(import.meta.dirname, '../../packages/ui/src/theme/tokens.css'),
      '@mathslot/ui': resolve(import.meta.dirname, '../../packages/ui/src/index.ts'),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist-e2e'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
  },
});
