import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ['browser'],
    alias: {
      '@mathslot/ui/tokens.css': resolve(import.meta.dirname, '../../packages/ui/src/theme/tokens.css'),
      '@mathslot/ui': resolve(import.meta.dirname, '../../packages/ui/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
