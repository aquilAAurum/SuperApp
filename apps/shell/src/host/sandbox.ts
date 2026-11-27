/**
 * Builds the document a subapp runs in (spec §Security, subapp isolation).
 *
 * The shell fetches the bundle's entry HTML and parses it with DOMParser (inert: no scripts run, no
 * resources load), then:
 *   1. inserts <base href> for the bundle directory,
 *   2. inserts a Content-Security-Policy <meta> *before any subapp content* with a fresh nonce and
 *      `connect-src 'none'`, so the subapp cannot make network requests itself,
 *   3. stamps the nonce on every <script> present in the bundle (inline scripts the author shipped),
 * and serves the result via `srcdoc` into an iframe with sandbox="allow-scripts allow-forms" (no
 * allow-same-origin → opaque origin, no top navigation, no popups).
 */
export const IFRAME_SANDBOX = 'allow-scripts allow-forms';

/** Permissions Policy for the iframe: nothing powerful is delegated; capabilities go through the bridge. */
export const IFRAME_ALLOW = "camera 'none'; microphone 'none'; geolocation 'none'; usb 'none'; serial 'none'; bluetooth 'none'; payment 'none'; clipboard-read 'none'; display-capture 'none'";

export function subappCsp(nonce: string, bundleOrigin: string, bundleBase: string): string {
  const assets = `${bundleOrigin}${bundleBase}`;
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${assets}`,
    `style-src 'unsafe-inline' ${assets}`,
    `img-src data: blob: ${assets}`,
    `font-src data: ${assets}`,
    `media-src data: blob: ${assets}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

export interface SrcdocInput {
  html: string;
  nonce: string;
  bundleOrigin: string;
  /** Path of the bundle directory, with leading and trailing slash, e.g. `/builtin/hello/1.0.0/`. */
  bundleBase: string;
  parse?: (html: string) => Document;
}

export function buildSrcdoc({ html, nonce, bundleOrigin, bundleBase, parse }: SrcdocInput): string {
  const doc = (parse ?? ((h) => new DOMParser().parseFromString(h, 'text/html')))(html);
  // Remove author-supplied <base> elements; ours is the only one (base-uri 'none' blocks later ones too).
  for (const b of Array.from(doc.querySelectorAll('base'))) b.remove();

  const base = doc.createElement('base');
  base.setAttribute('href', `${bundleOrigin}${bundleBase}`);
  const csp = doc.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', subappCsp(nonce, bundleOrigin, bundleBase));
  const referrer = doc.createElement('meta');
  referrer.setAttribute('name', 'referrer');
  referrer.setAttribute('content', 'no-referrer');

  doc.head.prepend(base, csp, referrer);
  for (const s of Array.from(doc.querySelectorAll('script'))) s.setAttribute('nonce', nonce);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes));
}
