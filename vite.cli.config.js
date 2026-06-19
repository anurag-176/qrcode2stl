import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: false,
  build: {
    target: 'node20',
    outDir: 'dist-cli',
    emptyOutDir: true,
    ssr: resolve(__dirname, 'src/cli/index.js'),
    rollupOptions: {
      output: {
        entryFileNames: 'qrcode2stl.js',
      },
    },
  },
});
