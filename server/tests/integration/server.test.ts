import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8090';
const SU_EMAIL = process.env.PB_SUPERUSER_EMAIL ?? 'ci-admin@example.test';
const SU_PASSWORD = process.env.PB_SUPERUSER_PASSWORD ?? 'ci-admin-password-123';

async function api(path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${PB}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(init.token ? { authorization: init.token } : {}), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const rid = () => Array.from({ length: 15 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
const opId = () => crypto.randomUUID();

let su = '';
let user = '';
let userId = '';
let deviceId = '';

beforeAll(async () => {
  const s = await api('/api/collections/_superusers/auth-with-password', { body: { identity: SU_EMAIL, password: SU_PASSWORD } });
  expect(s.status).toBe(200);
  su = s.body.token;
  const email = `owner-${Date.now()}@example.test`;
  const created = await api('/api/collections/users/records', { token: su, body: { email, password: 'owner-password-123', passwordConfirm: 'owner-password-123', name: 'Owner' } });
  expect(created.status).toBe(200);
  const u = await api('/api/collections/users/auth-with-password', { body: { identity: email, password: 'owner-password-123' } });
  user = u.body.token;
  userId = u.body.record.id;
});

describe('migrations', () => {
  it('apply on a clean data dir and record schema version 1', async () => {
    const r = await api('/api/collections/schema_info/records', { token: user });
    expect(r.status).toBe(200);
    expect(r.body.items[0].version).toBe(1);
  });
});

describe('device registration (core_devices)', () => {
  it('lets the owner register a device and refuses foreign owners', async () => {
    const ok = await api('/api/collections/core_devices/records', { token: user, body: { name: 'Pixel', kind: 'phone', formFactor: 'phone', shellVersion: '0.1.0', capabilities: {}, owner: userId } });
    expect(ok.status).toBe(200);
    deviceId = ok.body.id;
    const bad = await api('/api/collections/core_devices/records', { token: user, body: { name: 'X', kind: 'phone', formFactor: 'phone', owner: 'aaaaaaaaaaaaaaa' } });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
});

describe('app collections (hello_notes)', () => {
  it('are synced: written through ops, versioned, unreachable directly', async () => {
    const id = rid();
    const r = await api('/api/sa/ops', { token: user, body: { opId: opId(), collection: 'hello_notes', recordId: id, op: 'create', payload: { text: 'hi', n: 1 } } });
    expect(r.status).toBe(200);
    expect(r.body.record).toMatchObject({ id, version: 1, deleted: false });
    const direct = await api('/api/collections/hello_notes/records', { token: user, body: { text: 'x', owner: userId, version: 1 } });
    expect(direct.status).toBe(403);
  });
});

describe('POST /api/sa/ops (version + idempotency hooks)', () => {
  it('same opId twice → one record (M1 acceptance)', async () => {
    const id = rid();
    const op = { opId: opId(), collection: 'core_people', recordId: id, op: 'create', payload: { displayName: 'Ada' } };
    const headers = { 'x-superapp-device': deviceId };
    const a = await api('/api/sa/ops', { token: user, body: op, headers });
    const b = await api('/api/sa/ops', { token: user, body: op, headers });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.replayed).toBe(true);
    const list = await api(`/api/collections/core_people/records?filter=${encodeURIComponent(`id="${id}"`)}`, { token: user });
    expect(list.body.totalItems).toBe(1);
    expect(list.body.items[0]).toMatchObject({ version: 1, owner: userId, origin_device: deviceId, deleted: false });
  });

  it('bumps version on update and returns 409 on a stale baseVersion', async () => {
    const id = rid();
    await api('/api/sa/ops', { token: user, body: { opId: opId(), collection: 'core_people', recordId: id, op: 'create', payload: { displayName: 'A' } } });
    const up = await api('/api/sa/ops', { token: user, body: { opId: opId(), collection: 'core_people', recordId: id, op: 'update', payload: { displayName: 'B' }, baseVersion: 1 } });
    expect(up.status).toBe(200);
    expect(up.body.record.version).toBe(2);
    const stale = await api('/api/sa/ops', { token: user, body: { opId: opId(), collection: 'core_people', recordId: id, op: 'update', payload: { displayName: 'C' }, baseVersion: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.body.server.displayName).toBe('B');
  });

  it('restore brings back a soft-deleted record (ADR-005)', async () => {
    const id = rid();
    await api('/api/sa/ops', { token: user, body: { opId: opId(), collection: 'core_people', recordId: id, op: 'create', payload: { displayName: 'A' } } });
    const del = await api('/api/sa/ops', { token: user, body: { opId: opId(), collection: 'core_people', recordId: id, op: 'delete', baseVersion: 1 } });
    expect(del.body.record).toMatchObject({ deleted: true, version: 2 });
    const res = await api('/api/sa/ops', { token: user, body: { opId: opId(), collection: 'core_people', recordId: id, op: 'restore', payload: { displayName: 'A2' }, baseVersion: 2 } });
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({ deleted: false, version: 3, displayName: 'A2' });
  });

  it('rejects invalid records with 400 and writes nothing', async () => {
    const id = rid();
    const r = await api('/api/sa/ops', { token: user, body: { opId: opId(), collection: 'core_people', recordId: id, op: 'create', payload: { displayName: '' } } });
    expect(r.status).toBe(400);
    const list = await api(`/api/collections/core_people/records?filter=${encodeURIComponent(`id="${id}"`)}`, { token: user });
    expect(list.body.totalItems).toBe(0);
  });

  it('requires auth', async () => {
    const r = await api('/api/sa/ops', { body: { opId: opId(), collection: 'core_people', recordId: rid(), op: 'create', payload: { displayName: 'x' } } });
    expect(r.status).toBe(401);
  });
});

describe('contacts subapp collections (SA-2026-007)', () => {
  const op = (collection: string, recordId: string, o: string, payload?: Record<string, unknown>, baseVersion?: number) =>
    api('/api/sa/ops', { token: user, body: { opId: opId(), collection, recordId, op: o, ...(payload ? { payload } : {}), ...(baseVersion ? { baseVersion } : {}) } });
  const core = async (id: string) => (await api(`/api/collections/core_people/records/${id}`, { token: user })).body;

  it('mirror each contact into core_people (same id), with phones and emails, through delete and restore', async () => {
    const id = rid();
    expect((await op('contacts_entities', id, 'create', { kind: 'person', title: 'Ava Torres', title_key: 'ava torres' })).status).toBe(200);
    expect((await op('contacts_people', id, 'create', { entity: id, display_name: 'Ava Torres' })).status).toBe(200);
    expect((await op('contacts_contact_points', rid(), 'create', { entity: id, channel: 'phone', value: '(555) 010-2030', value_norm: '+15550102030', is_primary: true, is_valid: true, source: 'vault:phone' })).status).toBe(200);
    expect((await op('contacts_contact_points', rid(), 'create', { entity: id, channel: 'email', value: 'ava@example.com', value_norm: 'ava@example.com', is_primary: true, is_valid: true, source: 'vault:email' })).status).toBe(200);

    let c = await core(id);
    expect(c).toMatchObject({ id, displayName: 'Ava Torres', owner: userId, deleted: false, sourceIds: { contacts: id } });
    expect(c.phones).toEqual([{ e164: '+15550102030', type: 'phone', label: null, primary: true }]);
    expect(c.emails).toEqual([{ address: 'ava@example.com', label: null, primary: true }]);
    const person = (await api(`/api/collections/contacts_people/records/${id}`, { token: user })).body;
    expect(person.core_person).toBe(id);

    const del = await op('contacts_people', id, 'delete', undefined, person.version);
    expect(del.status).toBe(200);
    expect((await core(id)).deleted).toBe(true);
    expect((await op('contacts_people', id, 'restore', undefined, del.body.record.version)).status).toBe(200);
    c = await core(id);
    expect(c.deleted).toBe(false);
    expect(c.phones).toHaveLength(1);
  });

  it('serve the reach-out and backlinks SQL views to the owner only', async () => {
    const id = rid();
    await op('contacts_entities', id, 'create', { kind: 'person', title: 'Ben Okafor', title_key: 'ben okafor' });
    await op('contacts_people', id, 'create', { entity: id, display_name: 'Ben Okafor', cadence_days: 30, last_touch: '2026-10-01' });
    const view = await api(`/api/collections/contacts_reach_out/records?filter=${encodeURIComponent(`entity="${id}"`)}`, { token: user });
    expect(view.body.items[0]).toMatchObject({ display_name: 'Ben Okafor', due_on: '2026-10-31' });
    const anon = await api('/api/collections/contacts_reach_out/records');
    expect(anon.body.totalItems ?? 0).toBe(0);
    const direct = await api('/api/collections/contacts_people/records', { token: user, body: { entity: id, display_name: 'x', owner: userId, version: 1 } });
    expect(direct.status).toBe(403);
  });
});

describe('eatwell subapp collections (SA-2026-008)', () => {
  const op = (collection: string, recordId: string, o: string, payload?: Record<string, unknown>, baseVersion?: number) =>
    api('/api/sa/ops', { token: user, body: { opId: opId(), collection, recordId, op: o, ...(payload ? { payload } : {}), ...(baseVersion ? { baseVersion } : {}) } });

  it('take diary entries, weights, water and settings through ops, versioned and owner-only', async () => {
    const e = rid();
    const created = await op('eatwell_entries', e, 'create', { date: '2026-11-28', meal: 'breakfast', name: 'Banana', servings: 2, serving_label: '1 medium (118 g)', food_ref: 'b:banana', kcal: 210, protein_g: 2.6, carbs_g: 54 });
    expect(created.status).toBe(200);
    expect(created.body.record).toMatchObject({ id: e, version: 1, kcal: 210, meal: 'breakfast' });
    const updated = await op('eatwell_entries', e, 'update', { servings: 1, kcal: 105 }, 1);
    expect(updated.body.record).toMatchObject({ version: 2, kcal: 105 });
    expect((await op('eatwell_weights', rid(), 'create', { date: '2026-11-28', kg: 85.2 })).status).toBe(200);
    expect((await op('eatwell_water', rid(), 'create', { date: '2026-11-28', ml: 250 })).status).toBe(200);
    expect((await op('eatwell_settings', rid(), 'create', { units: 'imperial', rate_kg_week: -0.5, protein_pct: 30, carbs_pct: 40, fat_pct: 30, exercise_adds: true })).status).toBe(200);
    const direct = await api('/api/collections/eatwell_entries/records', { token: user, body: { date: '2026-11-28', meal: 'lunch', name: 'x', owner: userId, version: 1 } });
    expect(direct.status).toBe(403);
    const anon = await api('/api/collections/eatwell_entries/records');
    expect(anon.body.totalItems ?? 0).toBe(0);
  });

  it('reject malformed diary records', async () => {
    expect((await op('eatwell_entries', rid(), 'create', { date: '28/11/2026', meal: 'breakfast', name: 'Bad date' })).status).toBe(400);
    expect((await op('eatwell_entries', rid(), 'create', { date: '2026-11-28', meal: 'brunch', name: 'Bad meal' })).status).toBe(400);
    expect((await op('eatwell_weights', rid(), 'create', { date: '2026-11-28', kg: 5000 })).status).toBe(400);
  });
});

describe('access rules', () => {
  it('synced collections cannot be written directly by clients', async () => {
    const r = await api('/api/collections/core_people/records', { token: user, body: { displayName: 'Direct', owner: userId, version: 1 } });
    expect(r.status).toBe(403);
  });

  it('integration secrets are never readable by clients', async () => {
    const c = await api('/api/collections/core_integrations/records', { token: su, body: { kind: 'anthropic', baseUrl: 'https://api.example.test', secret: 'sk-test-secret' } });
    expect(c.status).toBe(200);
    // Superusers (admin UI on the mini PC) may see hidden fields; the phone only ever holds the owner's token.
    const list = await api('/api/collections/core_integrations/records', { token: user });
    expect(list.status).toBe(403);
    const view = await api(`/api/collections/core_integrations/records/${c.body.id}`, { token: user });
    expect(view.status).toBeGreaterThanOrEqual(403);
    expect(JSON.stringify([list.body, view.body])).not.toContain('sk-test-secret');
  });
});

describe('published subapps (ADR-009)', () => {
  // Must be the inbox of the server under test: <hooksDir>/../subapps_inbox (server/subapps_inbox in the
  // Linux job; the Windows job sets SUPRA_SUBAPPS_INBOX to the installed copy's inbox).
  const inbox = `${process.env.SUPRA_SUBAPPS_INBOX ?? fileURLToPath(new URL('../../subapps_inbox', import.meta.url))}/`;
  const id = `itest${Date.now().toString(36)}`.slice(0, 20);
  const m = (version: string) => ({ id, name: 'Itest', version, sdk: '>=1.0 <2.0', entry: 'index.html', formFactors: ['phone'], scopes: { required: [], optional: [] }, collections: [], events: { emits: [], listens: [] }, deepLinks: [], intents: [], car: null, background: { tasks: [] } });
  const put = (version: string, opts: { sha?: string; manifestId?: string } = {}) => {
    const zip = zipSync({ 'app.json': new TextEncoder().encode(JSON.stringify(m(version))), 'index.html': new TextEncoder().encode(`<p>${version}</p>`) });
    const sha = createHash('sha256').update(zip).digest('hex');
    const dir = `${inbox}${id}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${id}-${version}.zip`, zip);
    writeFileSync(`${dir}/${id}-${version}.zip.sha256`, `${opts.sha ?? sha}  ${id}-${version}.zip\n`);
    writeFileSync(`${dir}/${id}-${version}.json`, JSON.stringify({ ...m(version), id: opts.manifestId ?? id }));
    return { zip, sha };
  };

  it('imports new bundles from the inbox once, refuses bad ones, and serves zips only with a file token', async () => {
    const good = put('1.0.0');
    put('1.0.1', { manifestId: 'someoneelse' });
    put('not-a-version');
    try {
      const denied = await api('/api/sa/subapps/import', { method: 'POST', token: user });
      expect(denied.status).toBeGreaterThanOrEqual(401); // owner token is not a superuser
      const r = await api('/api/sa/subapps/import', { method: 'POST', token: su });
      expect(r.status).toBe(200);
      // Other bundles may share the inbox (the Windows job syncs published/ first); check only ours.
      expect(r.body.imported.filter((x: string) => x.startsWith(`${id}@`))).toEqual([`${id}@1.0.0`]);
      expect(r.body.errors.filter((e: { path: string }) => e.path.startsWith(`${id}/`)).map((e: { reason: string }) => e.reason).sort()).toEqual(['manifest id/version/entry do not match the file name', 'version not-a-version is not semantic (1.2.3)']);
      const again = await api('/api/sa/subapps/import', { method: 'POST', token: su });
      expect(again.body.imported.filter((x: string) => x.startsWith(`${id}@`))).toEqual([]);

      const list = await api(`/api/collections/subapps/records?filter=${encodeURIComponent(`appId = "${id}"`)}`, { token: user });
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      const rec = list.body.items[0];
      expect(rec).toMatchObject({ appId: id, version: '1.0.0', sha256: good.sha, channel: 'stable' });
      const anon = await api(`/api/collections/subapps/records?filter=${encodeURIComponent(`appId = "${id}"`)}`);
      expect(anon.body.items ?? []).toHaveLength(0);

      const fileUrl = `${PB}/api/files/subapps/${rec.id}/${rec.bundle}`;
      expect((await fetch(fileUrl)).status).toBe(404); // protected field: no token, no file
      const tok = await api('/api/files/token', { method: 'POST', token: user });
      const dl = await fetch(`${fileUrl}?token=${tok.body.token}`);
      expect(dl.status).toBe(200);
      expect(createHash('sha256').update(new Uint8Array(await dl.arrayBuffer())).digest('hex')).toBe(good.sha);

      const write = await api('/api/collections/subapps/records', { token: user, body: { appId: id, version: '9.9.9' } });
      expect(write.status).toBeGreaterThanOrEqual(400); // clients cannot publish
    } finally {
      rmSync(`${inbox}${id}`, { recursive: true, force: true });
    }
  });
});

describe('Today projections (SA-2026-009, ADR-011)', () => {
  const op = (collection: string, recordId: string, o: string, payload?: Record<string, unknown>, baseVersion?: number) =>
    api('/api/sa/ops', { token: user, body: { opId: opId(), collection, recordId, op: o, ...(payload ? { payload } : {}), ...(baseVersion ? { baseVersion } : {}) } });
  const agenda = async (key: string) =>
    (await api(`/api/collections/core_agenda/records?filter=${encodeURIComponent(`source_key="${key}"`)}`, { token: user })).body.items as Record<string, unknown>[];

  it('projects a contact key date and a reach-out due date into core_agenda', async () => {
    const id = rid();
    await op('contacts_entities', id, 'create', { kind: 'person', title: 'Cleo Park', title_key: 'cleo park' });
    await op('contacts_people', id, 'create', { entity: id, display_name: 'Cleo Park', next_touch: '2030-01-15' });
    const kd = rid();
    expect((await op('contacts_key_dates', kd, 'create', { entity: id, kind: 'birthday', month: 6, day: 1, recurring: true, source: 'test' })).status).toBe(200);

    const [birthday] = await agenda(`contacts:key_date:${kd}`);
    expect(birthday).toMatchObject({ kind: 'date', title: 'Birthday: Cleo Park', all_day: true, source_app: 'contacts', person: id, deleted: false, version: 1 });
    const [reach] = await agenda(`contacts:reach_out:${id}`);
    expect(reach).toMatchObject({ kind: 'task', title: 'Reach out to Cleo Park', start: '2030-01-15', person: id });
  });

  it('projects EatWell intake into a daily core_glances card', async () => {
    const date = '2030-02-03';
    await op('eatwell_entries', rid(), 'create', { date, meal: 'breakfast', name: 'Oats', kcal: 300 });
    await op('eatwell_water', rid(), 'create', { date, ml: 500 });
    const res = await api(`/api/collections/core_glances/records?filter=${encodeURIComponent(`app_id="eatwell" && date="${date}"`)}`, { token: user });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ key: 'intake', value: 300, unit: 'kcal', detail: '500 ml water' });
  });

  it('core_agenda accepts items from apps through ops and rejects malformed times', async () => {
    const ok = await op('core_agenda', rid(), 'create', { kind: 'focus', title: 'Deep work', start: '2030-03-01T09:00', end: '2030-03-01T10:30', source_app: 'shell', status: 'open' });
    expect(ok.status).toBe(200);
    const bad = await op('core_agenda', rid(), 'create', { kind: 'event', title: 'x', start: 'tomorrow', source_app: 'shell' });
    expect(bad.status).toBe(400);
  });
});
