import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { buildZip, mergeIndex, sha256 } from './pack-lib.mjs';

const enc = (s) => new TextEncoder().encode(s);

describe('pack-lib', () => {
  it('builds a deterministic zip with app.json at the root', () => {
    const files = { 'index.html': enc('<p>hi</p>'), 'app.json': enc('{}') };
    const a = buildZip(files);
    const b = buildZip({ 'app.json': enc('{}'), 'index.html': enc('<p>hi</p>') });
    expect(sha256(a)).toBe(sha256(b));
    expect(Object.keys(unzipSync(a)).sort()).toEqual(['app.json', 'index.html']);
  });

  it('refuses unsafe paths and bundles without app.json', () => {
    expect(() => buildZip({ 'app.json': enc('{}'), '../evil': enc('x') })).toThrow(/unsafe/);
    expect(() => buildZip({ '/abs': enc('x'), 'app.json': enc('{}') })).toThrow(/unsafe/);
    expect(() => buildZip({ 'index.html': enc('x') })).toThrow(/app.json/);
  });

  it('keeps one entry per app in the built-in index', () => {
    let idx = mergeIndex(null, { base: '/builtin/b/1.0.0/', manifest: { id: 'b' } });
    idx = mergeIndex(idx, { base: '/builtin/a/1.0.0/', manifest: { id: 'a' } });
    idx = mergeIndex(idx, { base: '/builtin/b/1.1.0/', manifest: { id: 'b' } });
    expect(idx.apps.map((x) => x.base)).toEqual(['/builtin/a/1.0.0/', '/builtin/b/1.1.0/']);
  });
});
