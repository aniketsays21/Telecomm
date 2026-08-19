import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      entry: 'src/index.tsx',
      name: 'TelecommWidget',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        entryFileNames: 'widget.js',
      },
    },
    cssCodeSplit: false,
    outDir: 'dist',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});
