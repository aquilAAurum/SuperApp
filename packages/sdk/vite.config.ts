import { defineConfig } from 'vite';

// IIFE + ES builds. Subapps normally bundle the SDK from source; the IIFE is for plain-HTML subapps.
export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', name: 'SuperApp', formats: ['es', 'iife'], fileName: (f) => `superapp-sdk.${f}.js` },
    minify: true,
    target: 'es2020',
    emptyOutDir: true,
  },
});
