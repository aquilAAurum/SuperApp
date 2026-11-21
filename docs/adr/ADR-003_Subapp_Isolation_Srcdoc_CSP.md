---
id: ADR-003
title: Subapp isolation through srcdoc documents with a shell-injected nonce CSP
status: Proposed
date: 2026-11-21
decided_by: nick
supersedes: []
---

# ADR-003: Subapp isolation through `srcdoc` with a shell-injected CSP

## 1. Context

The spec requires sandboxed iframes without `allow-same-origin` and a Content Security Policy with `connect-src 'none'`, so subapps cannot make network requests themselves. A subapp controls its own HTML, so a CSP it ships itself cannot be trusted, and a Capacitor WebView serving local files cannot attach per-path response headers.

## 2. Decision

1. The shell fetches the bundle's entry HTML from its own origin and parses it with `DOMParser` (inert).
2. It removes author `<base>` elements and prepends, **before any subapp content**: `<base href>` for the bundle directory, a CSP `<meta>` with a fresh nonce (`default-src 'none'; script-src 'nonce-…' <bundle dir>; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; …`) and `referrer: no-referrer`.
3. It stamps the nonce on every `<script>` in the bundle and loads the result via `srcdoc` into `<iframe sandbox="allow-scripts allow-forms" allow="camera 'none'; …">`.
4. The handshake authenticates `hello` by `event.source` identity (the frame's origin is opaque, `"null"`), then transfers a private `MessagePort`.

Implementation: `apps/shell/src/host/sandbox.ts`, `frames.ts`, `bridge/handshake.ts`.

## 3. Consequences

- **Bundle format:** subapps ship a self-contained `index.html` (inline scripts and styles, data-URI assets), as `subapps/hello` does with `vite-plugin-singlefile`. Scripts loaded from the bundle directory must be classic scripts, because module scripts from an opaque origin need CORS headers the local server does not send. Documented in `docs/subapp-authoring.md`.
- **Media (M6):** Jellyfin streams need `media-src` for the stream origin; that is added per app from its granted `media.play` scope, not globally.
- **Cleartext:** the APK disallows cleartext and mixed content, so the phone uses Tailscale Serve HTTPS. The URL policy still accepts LAN/Tailscale `http://` for browser development.
- Residual risks are listed in `THREAT_MODEL.md` §E.
