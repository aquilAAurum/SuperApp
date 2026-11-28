import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The viewer is vendored from Supra---Contacts src/viewer/ (its source of truth). A change here
// without the same change there fails this test: update Supra---Contacts first, copy, then re-pin.
const PINNED = {
  'graph-viewer.js': '48c09e1480c4069eeda6323db2f1b478c9bcc99a6c70630fb35d270bf6685857',
  'graph-viewer.css': '54df83acd9782a75ffd00e5960ff0359956674952c3f02d408062a409e020407',
};

describe('vendored graph viewer', () => {
  for (const [file, sha] of Object.entries(PINNED)) {
    it(`${file} matches the Supra---Contacts copy`, () => {
      const got = createHash('sha256').update(readFileSync(new URL(`./viewer/${file}`, import.meta.url))).digest('hex');
      expect(got).toBe(sha);
    });
  }
  it('uses no HTML-string sinks, network or dynamic code (subapp CSP rules)', () => {
    const src = readFileSync(new URL('./viewer/graph-viewer.js', import.meta.url), 'utf8');
    for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'fetch(', 'XMLHttpRequest', 'WebSocket']) expect(src).not.toContain(banned);
  });
});
