import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

function readWasmBase64(): string {
  const wasmPath = resolve(import.meta.dirname, 'src/wasm-pkg/mathslot_wasm_bg.wasm');
  if (!existsSync(wasmPath)) {
    return '';
  }
  return readFileSync(wasmPath).toString('base64');
}

function stripDeadWasmUrlPlugin(): Plugin {
  return {
    name: 'mathslot-strip-dead-wasm-url',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('mathslot_wasm.js')) {
        return null;
      }
      const next = code.replace(
        /new URL\(\s*['"]mathslot_wasm_bg\.wasm['"]\s*,\s*import\.meta\.url\s*\)/g,
        'undefined',
      );
      return next === code ? null : { code: next, map: null };
    },
  };
}

export default defineConfig({
  plugins: [stripDeadWasmUrlPlugin(), svelte()],
  define: {
    'import.meta.url': '""',
    __MATHSLOT_INLINE_WASM_B64__: JSON.stringify(readWasmBase64()),
  },
  resolve: {
    alias: {
      '@mathslot/ui/tokens.css': resolve(import.meta.dirname, '../../packages/ui/src/theme/tokens.css'),
      '@mathslot/ui': resolve(import.meta.dirname, '../../packages/ui/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    minify: 'oxc',
    lib: {
      entry: resolve(import.meta.dirname, 'src/plugin.ts'),
      name: 'MathSlotPlugin',
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: ['obsidian'],
      output: {
        exports: 'default',
        assetFileNames: (assetInfo) => {
          const names = assetInfo.names ?? [];
          if (names.some((name) => name.endsWith('.css'))) {
            return 'styles.css';
          }
          return '[name][extname]';
        },
      },
    },
  },
});
