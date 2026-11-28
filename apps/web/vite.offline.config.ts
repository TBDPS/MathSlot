import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  base: './',
  publicDir: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    target: 'es2022',
    outDir: 'dist-offline',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    lib: {
      entry: 'src/main.ts',
      name: 'MathSlotOffline',
      formats: ['iife'],
      fileName: () => 'app.iife.js',
    },
    rolldownOptions: {
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
