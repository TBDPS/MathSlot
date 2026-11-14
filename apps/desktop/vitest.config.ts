import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
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
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
