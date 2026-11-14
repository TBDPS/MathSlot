import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const testWasmB64 = readFileSync(
  resolve(import.meta.dirname, '../obsidian/src/wasm-pkg/mathslot_wasm_bg.wasm'),
).toString('base64');

export default defineConfig({
  plugins: [svelte()],
  define: {
    __MATHSLOT_TEST_WASM_B64__: JSON.stringify(testWasmB64),
  },
  resolve: {
    conditions: ['browser'],
    alias: {
      '@mathslot/ui/tokens.css': resolve(import.meta.dirname, '../../packages/ui/src/theme/tokens.css'),
      '@mathslot/ui': resolve(import.meta.dirname, '../../packages/ui/src/index.ts'),
      '@mathslot/wasm': resolve(import.meta.dirname, '../obsidian/src/wasm-pkg/mathslot_wasm.js'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
