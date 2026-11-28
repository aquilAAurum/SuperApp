import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildZip, sha256 } from './pack-lib.mjs';
import { checkPublished, publishedVersions } from './published-lib.mjs';

const manifest = (id, version) => ({
  id, name: id, version, sdk: '>=1.0 <2.0', entry: 'index.html', formFactors: ['phone'],
  scopes: { required: ['data.own'], optional: [] }, collections: [], events: { emits: [], listens: [] },
  deepLinks: [], intents: [], car: null, background: { tasks: [] },
});
const enc = (s) => new TextEncoder().encode(s);

function publish(root, id, version, { zipManifest = manifest(id, version), json = manifest(id, version), sha } = {}) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const zip = buildZip({ 'app.json': enc(JSON.stringify(zipManifest, null, 2)), 'index.html': enc('<p>hi</p>') });
  const name = `${id}-${version}.zip`;
  writeFileSync(join(dir, name), zip);
  writeFileSync(join(dir, `${name}.sha256`), `${sha ?? sha256(zip)}  ${name}\n`);
  writeFileSync(join(dir, `${id}-${version}.json`), JSON.stringify(json, null, 2));
}

describe('published/ folder', () => {
  it('accepts intact bundles and lists versions in semantic order', () => {
    const root = mkdtempSync(join(tmpdir(), 'pub-'));
    publish(root, 'notes', '1.10.0');
    publish(root, 'notes', '1.9.0');
    expect(checkPublished(root)).toEqual([]);
    expect(publishedVersions(join(root, 'notes'), 'notes')).toEqual(['1.9.0', '1.10.0']);
  });

  it('flags a wrong hash, a zip for another app, and a .json that disagrees with the zip', () => {
    const root = mkdtempSync(join(tmpdir(), 'pub-'));
    publish(root, 'alpha', '1.0.0', { sha: 'f'.repeat(64) });
    publish(root, 'bravo', '1.0.0', { zipManifest: manifest('charlie', '1.0.0') });
    publish(root, 'delta', '1.0.0', { json: { ...manifest('delta', '1.0.0'), name: 'Changed' } });
    expect(checkPublished(root)).toEqual([
      'alpha/alpha-1.0.0: SHA-256 file does not match the zip',
      'bravo/bravo-1.0.0: zip says charlie@1.0.0',
      "delta/delta-1.0.0: .json differs from the zip's app.json",
    ]);
  });

  it('a missing folder is fine (nothing published yet)', () => {
    expect(checkPublished(join(tmpdir(), 'does-not-exist-pub'))).toEqual([]);
  });
});
