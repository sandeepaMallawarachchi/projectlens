import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));

// The webview bundle is loaded by the extension with fixed file names so the
// extension host can reference it with a nonce-based Content Security Policy.
export default defineConfig({
  root: here,
  plugins: [react()],
  base: './',
  build: {
    outDir: resolve(here, '../dist/webview'),
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      input: resolve(here, 'src/main.tsx'),
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: 'chunk-[name].js',
        assetFileNames: 'index.[ext]'
      }
    }
  }
});
