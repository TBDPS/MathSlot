import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'MathSlotUI',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['svelte', /^svelte\//],
    },
  },
});
