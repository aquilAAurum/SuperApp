// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildSrcdoc, subappCsp } from './sandbox.ts';

describe('buildSrcdoc', () => {
  const html = `<!doctype html><html><head><base href="https://evil.example/"><script>window.x=1</script></head><body><script src="app.js"></script></body></html>`;
  const out = buildSrcdoc({ html, nonce: 'N0NCE', bundleOrigin: 'https://localhost', bundleBase: '/builtin/hello/1.0.0/' });
  const doc = new DOMParser().parseFromString(out, 'text/html');

  it('puts base and CSP before any subapp content', () => {
    const first = Array.from(doc.head.children).slice(0, 2);
    expect(first[0]!.tagName).toBe('BASE');
    expect(first[0]!.getAttribute('href')).toBe('https://localhost/builtin/hello/1.0.0/');
    expect(first[1]!.getAttribute('http-equiv')).toBe('Content-Security-Policy');
  });

  it('removes author base elements', () => {
    expect(doc.querySelectorAll('base')).toHaveLength(1);
    expect(out).not.toContain('evil.example');
  });

  it('nonces every script', () => {
    const scripts = Array.from(doc.querySelectorAll('script'));
    expect(scripts).toHaveLength(2);
    expect(scripts.every((s) => s.getAttribute('nonce') === 'N0NCE')).toBe(true);
  });

  it('blocks network, frames, forms and base changes', () => {
    const csp = subappCsp('n', 'https://localhost', '/builtin/hello/1.0.0/');
    for (const d of ["connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'", "object-src 'none'", "default-src 'none'"]) {
      expect(csp).toContain(d);
    }
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toMatch(/script-src 'nonce-n' https:\/\/localhost\/builtin\/hello\/1\.0\.0\//);
  });
});
