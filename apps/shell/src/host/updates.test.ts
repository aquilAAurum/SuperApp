import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { MemoryKv } from '../sync/kv.ts';
import { compareVersions } from '@superapp/contracts';
import { SubappUpdater, verifyBundle, type SubappRecord } from './updates.ts';

const logs: { level: string; msg: string; fields: Record<string, unknown> }[] = [];
const logger = {
  debug: () => undefined,
  info: (msg: string, fields: Record<string, unknown> = {}) => void logs.push({ level: 'info', msg, fields }),
  warn: (msg: string, fields: Record<string, unknown> = {}) => void logs.push({ level: 'warn', msg, fields }),
  error: (msg: string, fields: Record<string, unknown> = {}) => void logs.push({ level: 'error', msg, fields }),
} as never;

const manifest = (id: string, version: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  version,
  sdk: '>=1.0 <2.0',
  entry: 'index.html',
  formFactors: ['phone'],
  scopes: { required: ['data.own'], optional: [] },
  collections: [],
  events: { emits: [], listens: [] },
  deepLinks: [],
  intents: [],
  car: null,
  background: { tasks: [] },
  ...extra,
});
const enc = (s: string) => new TextEncoder().encode(s);
function bundle(id: string, version: string, html = `<p>${id} ${version}</p>`, m: Record<string, unknown> = manifest(id, version)): { zip: Uint8Array; sha256: string } {
  const zip = zipSync({ 'app.json': enc(JSON.stringify(m)), 'index.html': enc(html) });
  return { zip, sha256: createHash('sha256').update(zip).digest('hex') };
}

class FakeServer {
  zips = new Map<string, Uint8Array>();
  records: SubappRecord[] = [];
  downloads = 0;
  publish(id: string, version: string, b = bundle(id, version), shaOverride?: string): void {
    const rid = `${id}${version.replace(/\W/g, '')}`.padEnd(15, '0').slice(0, 15);
    this.zips.set(rid, b.zip);
    this.records.push({ id: rid, appId: id, version, sha256: shaOverride ?? b.sha256, bundle: `${id}.zip` });
  }
  async listSubapps() {
    return this.records;
  }
  async downloadSubapp(r: SubappRecord) {
    this.downloads++;
    return this.zips.get(r.id)!;
  }
}

function setup(builtin: Record<string, string> = {}) {
  let t = 1_000_000;
  const kv = new MemoryKv();
  const server = new FakeServer();
  const make = () => new SubappUpdater({ kv, source: server, logger, builtinVersion: (id) => builtin[id] ?? null, now: () => t });
  return { kv, server, make, tick: (ms: number) => (t += ms) };
}

describe('versions', () => {
  it('orders semantic versions, releases above pre-releases, malformed below everything', () => {
    const sorted = ['1.10.0', '1.2.0', '1.2.0-beta.2', '1.2.0-beta.10', '0.9.9', 'junk', '1.2.1'].sort(compareVersions);
    expect(sorted).toEqual(['junk', '0.9.9', '1.2.0-beta.2', '1.2.0-beta.10', '1.2.0', '1.2.1', '1.10.0']);
  });
});

describe('SubappUpdater', () => {
  it('installs a newer server version, stores it, and survives a restart (offline afterwards)', async () => {
    const { server, make } = setup({ contacts: '0.1.0' });
    server.publish('contacts', '0.1.1');
    server.publish('contacts', '0.1.0');
    const u = make();
    expect(await u.check()).toEqual([{ appId: 'contacts', version: '0.1.1', outcome: 'installed' }]);
    const again = make(); // new shell process, same database
    const inst = await again.installed();
    expect(inst.map((b) => `${b.manifest.id}@${b.manifest.version}`)).toEqual(['contacts@0.1.1']);
    expect(await inst[0]!.loadHtml()).toBe('<p>contacts 0.1.1</p>');
    expect(await again.check()).toEqual([]); // nothing newer
    expect(server.downloads).toBe(1);
  });

  it('ignores versions not newer than the builtin copy', async () => {
    const { server, make } = setup({ contacts: '0.2.0' });
    server.publish('contacts', '0.1.1');
    expect(await make().check()).toEqual([]);
    expect(server.downloads).toBe(0);
  });

  it('rejects a zip whose hash does not match, a manifest for another app, and a missing entry', async () => {
    const { server, make } = setup();
    server.publish('tampered', '1.0.0', bundle('tampered', '1.0.0'), 'f'.repeat(64));
    server.publish('liar', '1.0.0', bundle('other', '1.0.0'));
    const noEntry = zipSync({ 'app.json': enc(JSON.stringify(manifest('noentry', '1.0.0'))) });
    server.publish('noentry', '1.0.0', { zip: noEntry, sha256: createHash('sha256').update(noEntry).digest('hex') });
    server.publish('badman', '1.0.0', bundle('badman', '1.0.0', 'x', manifest('badman', '1.0.0', { car: {} })));
    const res = await make().check();
    expect(res.map((r) => [r.appId, r.outcome, r.reason])).toEqual([
      ['tampered', 'rejected', 'SHA-256 does not match the server record'],
      ['liar', 'rejected', 'bundle is other@1.0.0, record says liar@1.0.0'],
      ['noentry', 'rejected', 'entry index.html missing'],
      ['badman', 'rejected', expect.stringContaining('invalid manifest')],
    ]);
    expect(await make().installed()).toEqual([]);
  });

  it('rolls back after two crashes within 60 s of the first run, never re-offers that version, keeps a later fix', async () => {
    const { server, make, tick } = setup({ contacts: '0.1.0' });
    server.publish('contacts', '0.1.1');
    const u = make();
    await u.check();
    server.publish('contacts', '0.1.2');
    await u.check();
    expect((await u.summary())[0]).toMatchObject({ server: '0.1.2', previous: '0.1.1' });
    expect(await u.onCrashed('contacts')).toEqual({ rolledBack: false });
    tick(20_000);
    expect(await u.onCrashed('contacts')).toEqual({ rolledBack: true, from: '0.1.2', to: '0.1.1' });
    expect((await u.current('contacts'))?.manifest.version).toBe('0.1.1');
    expect(logs.some((l) => l.msg === 'bundles.rolled_back' && l.fields.from === '0.1.2')).toBe(true);
    expect(await u.check()).toEqual([]); // 0.1.2 is marked bad
    server.publish('contacts', '0.1.3');
    expect((await u.check()).map((r) => r.version)).toEqual(['0.1.3']);
  });

  it('a crash after the 60 s window does not roll back; rolling back the only server version falls back to builtin', async () => {
    const { server, make, tick } = setup({ contacts: '0.1.0' });
    server.publish('contacts', '0.2.0');
    const u = make();
    await u.check();
    await u.onStarted('contacts');
    tick(61_000);
    expect(await u.onCrashed('contacts')).toEqual({ rolledBack: false });
    expect(await u.onCrashed('contacts')).toEqual({ rolledBack: false });
    expect(await u.rollback('contacts', 'manual')).toEqual({ rolledBack: true, from: '0.2.0', to: null });
    expect(await u.current('contacts')).toBeNull();
    expect(await u.installed()).toEqual([]);
  });

  it('verifyBundle refuses oversized input before hashing', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    await expect(verifyBundle({ id: 'x', appId: 'x', version: '1.0.0', sha256: '0'.repeat(64), bundle: 'x.zip' }, big)).rejects.toThrow(/max/);
  });
});
