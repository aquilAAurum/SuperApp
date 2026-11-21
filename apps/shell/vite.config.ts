import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Shell Content-Security-Policy (HB-ELEC-02 analogue for the WebView). No inline scripts, no eval.
 * connect-src must reach the user's server, whose address is only known at runtime; the URL policy in
 * src/core/url-policy.ts restricts it to HTTPS or LAN/Tailscale HTTP. Dev mode adds ws: for HMR.
 */
function shellCsp(dev: boolean): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' https: http:${dev ? ' ws:' : ''}`,
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function cspPlugin(): Plugin {
  let dev = false;
  return {
    name: 'superapp-csp',
    configResolved(c) {
      dev = c.command === 'serve';
    },
    transformIndexHtml(html) {
      return html.replace('%SHELL_CSP%', shellCsp(dev));
    },
  };
}

export default defineConfig({
  plugins: [svelte(), cspPlugin()],
  define: { __SHELL_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2022', sourcemap: true, outDir: 'dist', emptyOutDir: true },
  preview: { port: 4173, strictPort: true },
});
