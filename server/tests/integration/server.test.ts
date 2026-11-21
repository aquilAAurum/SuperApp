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

describe('access rules', () => {
  it('synced collections cannot be written directly by clients', async () => {
    const r = await api('/api/collections/core_people/records', { token: user, body: { displayName: 'Direct', owner: userId, version: 1 } });
    expect(r.status).toBe(403);
  });

  it('integration secrets are never readable by clients', async () => {
    const c = await api('/api/collections/core_integrations/records', { token: su, body: { kind: 'anthropic', baseUrl: 'https://api.example.test', secret: 'sk-test-secret' } });
    expect(c.status).toBe(200);
    expect(JSON.stringify(c.body)).not.toContain('sk-test-secret');
    const asUser = await api('/api/collections/core_integrations/records', { token: user });
    expect(asUser.status).toBe(403);
  });
});
