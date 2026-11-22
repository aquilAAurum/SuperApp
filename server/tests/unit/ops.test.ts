import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { applyOp, cleanPayload } = require('../../pb_hooks/lib/ops.js') as {
  applyOp: (store: FakeStore, op: unknown, ctx: { userId: string; deviceId?: string }) => { status: number; body: Record<string, unknown> };
  cleanPayload: (p: unknown) => Record<string, unknown>;
};

type Rec = Record<string, unknown> & { id: string; version: number; owner: string; deleted: boolean };

/** In-memory stand-in for PocketBase that mimics the version hook. */
class FakeStore {
  records = new Map<string, Rec>();
  processed = new Map<string, { owner: string; status: number; body: Record<string, unknown> }>();
  creates = 0;
  isSynced(c: string) {
    return c === 'core_people' || c.startsWith('budget_');
  }
  findProcessed(opId: string) {
    return this.processed.get(opId) ?? null;
  }
  findRecord(c: string, id: string) {
    const r = this.records.get(`${c}/${id}`);
    return r ? { ...r } : null;
  }
  create(c: string, data: Record<string, unknown>) {
    this.creates++;
    const r = { ...data, version: 1 } as Rec;
    this.records.set(`${c}/${r.id}`, r);
    return { ...r };
  }
  update(c: string, id: string, patch: Record<string, unknown>) {
    const prev = this.records.get(`${c}/${id}`)!;
    const r = { ...prev, ...patch, version: prev.version + 1 };
    this.records.set(`${c}/${id}`, r);
    return { ...r };
  }
  markProcessed(opId: string, x: { owner: string; status: number; body: Record<string, unknown> }) {
    if (this.processed.has(opId)) throw new Error('UNIQUE constraint failed: processed_ops.opId');
    this.processed.set(opId, x);
  }
}

const ctx = { userId: 'user00000000001', deviceId: 'device000000001' };
const create = (opId = 'op-create-0001', recordId = 'abcdefghij12345') => ({ opId, collection: 'core_people', recordId, op: 'create', payload: { displayName: 'Ada' } });

describe('applyOp', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it('same opId twice → one record, original result replayed (M1 acceptance)', () => {
    const first = applyOp(store, create(), ctx);
    const second = applyOp(store, create(), ctx);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(store.creates).toBe(1);
    expect(store.records.size).toBe(1);
    expect(second.body.record).toEqual(first.body.record);
    expect(second.body.replayed).toBe(true);
  });

  it('create stamps owner, origin_device, deleted=false and version=1', () => {
    const r = applyOp(store, create(), ctx).body.record as Rec;
    expect(r).toMatchObject({ id: 'abcdefghij12345', owner: ctx.userId, origin_device: ctx.deviceId, deleted: false, version: 1, displayName: 'Ada' });
  });

  it('clients cannot set server-owned fields', () => {
    const op = { ...create(), payload: { displayName: 'Ada', owner: 'someoneelse0000', version: 99, id: 'zzzzzzzzzzzzzzz', deleted: true } };
    const r = applyOp(store, op, ctx).body.record as Rec;
    expect(r).toMatchObject({ owner: ctx.userId, version: 1, id: 'abcdefghij12345', deleted: false });
    expect(cleanPayload({ a: 1, created: 'x', expand: {} })).toEqual({ a: 1 });
  });

  it('update applies when baseVersion matches and bumps version', () => {
    applyOp(store, create(), ctx);
    const res = applyOp(store, { opId: 'op-update-0001', collection: 'core_people', recordId: 'abcdefghij12345', op: 'update', payload: { displayName: 'Ada L.' }, baseVersion: 1 }, ctx);
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({ displayName: 'Ada L.', version: 2 });
  });

  it('stale baseVersion → 409 with the server record, and the conflict replays identically', () => {
    applyOp(store, create(), ctx);
    applyOp(store, { opId: 'op-update-0001', collection: 'core_people', recordId: 'abcdefghij12345', op: 'update', payload: { displayName: 'B' }, baseVersion: 1 }, ctx);
    const stale = { opId: 'op-update-0002', collection: 'core_people', recordId: 'abcdefghij12345', op: 'update', payload: { displayName: 'C' }, baseVersion: 1 };
    const res = applyOp(store, stale, ctx);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', server: { displayName: 'B', version: 2 } });
    expect(applyOp(store, stale, ctx).status).toBe(409);
    expect(store.records.get('core_people/abcdefghij12345')!.displayName).toBe('B');
  });

  it('delete is soft and version-checked; updates to deleted records are 404', () => {
    applyOp(store, create(), ctx);
    const del = applyOp(store, { opId: 'op-delete-0001', collection: 'core_people', recordId: 'abcdefghij12345', op: 'delete', baseVersion: 1 }, ctx);
    expect(del.body.record).toMatchObject({ deleted: true, version: 2 });
    const upd = applyOp(store, { opId: 'op-update-0003', collection: 'core_people', recordId: 'abcdefghij12345', op: 'update', payload: {}, baseVersion: 2 }, ctx);
    expect(upd).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
  });

  it('update of a missing record → 404', () => {
    expect(applyOp(store, { opId: 'op-update-0004', collection: 'core_people', recordId: 'missing00000000', op: 'update', payload: {}, baseVersion: 1 }, ctx).status).toBe(404);
  });

  it('refuses non-synced collections and other owners', () => {
    expect(applyOp(store, { ...create(), collection: 'core_integrations' }, ctx)).toMatchObject({ status: 403 });
    applyOp(store, create(), ctx);
    const other = { userId: 'user00000000002' };
    expect(applyOp(store, create(), other)).toMatchObject({ status: 409 }); // opId reused by someone else
    const upd = applyOp(store, { opId: 'op-other-00001', collection: 'core_people', recordId: 'abcdefghij12345', op: 'update', payload: {}, baseVersion: 1 }, other);
    expect(upd.status).toBe(404); // existence of another owner's record is not revealed
  });

  it.each([
    [{}, 'opId'],
    [{ ...create(), opId: 'x' }, 'opId'],
    [{ ...create(), recordId: 'UPPER' }, 'recordId'],
    [{ ...create(), op: 'upsert' }, 'op must'],
    [{ ...create(), payload: [] }, 'payload'],
    [{ opId: 'op-update-0005', collection: 'core_people', recordId: 'abcdefghij12345', op: 'update', payload: {} }, 'baseVersion'],
  ])('rejects invalid ops with 400 (%#)', (op, msg) => {
    const res = applyOp(store, op, ctx);
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain(msg);
    expect(store.processed.size).toBe(0);
  });

  it('validation failures from the store are final 400s and are replayed, not retried', () => {
    const invalid = Object.assign(Object.create(Object.getPrototypeOf(store)), store, { create: () => ({ invalid: 'displayName: Cannot be blank.' }) });
    const res = applyOp(invalid, create('op-invalid-0001'), ctx);
    expect(res).toMatchObject({ status: 400, body: { code: 'INVALID_PARAMS' } });
    expect(String(res.body.message)).toContain('Cannot be blank');
    expect(store.records.size).toBe(0);
  });

  it('requires an authenticated user', () => {
    expect(applyOp(store, create(), { userId: '' }).status).toBe(401);
  });
});
