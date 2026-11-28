import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Subapps ship as one self-contained index.html: the shell serves it through `srcdoc` with a
// nonce-based CSP (see apps/shell/src/host/sandbox.ts), so inline scripts are nonced by the shell.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: 'es2020', outDir: 'dist', emptyOutDir: true },
});
