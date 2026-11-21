import { describe, expect, it, vi } from 'vitest';
import { MemoryKv } from './kv.ts';
import { SyncEngine } from './engine.ts';
import { FakeOpsServer } from '../../tests/support/fake-ops-server.ts';
import { quietLogger } from '../test-helpers.ts';
import type { OutboxRow } from './store.ts';

function setup() {
  const fake = new FakeOpsServer();
  const events: { appId: string; topic: string; payload: unknown }[] = [];
  const engine = new SyncEngine({
    kv: new MemoryKv(),
    logger: quietLogger().logger,
    deviceId: () => 'device000000001',
    emit: (appId, topic, payload) => events.push({ appId, topic, payload }),
    server: {
      sendOp: (row: OutboxRow) => fake.send(row),
      listSince: async (c, since) => fake.since(c, since ?? ''),
      getRecord: async (c, id) => fake.records.get(`${c}/${id}`) ?? null,
    },
    debounceMs: 0,
  });
  return { engine, fake, events };
}

describe('SyncEngine', () => {
  it('reports Pending → Synced, Offline, and Error for items needing attention', async () => {
    const { engine, fake } = setup();
    fake.online = false;
    await engine.data.create('hello', 'hello_notes', { n: 1 });
    await engine.sync();
    expect(engine.status.get()).toMatchObject({ label: 'Offline', queued: 1 });
    fake.online = true;
    engine.setOnline(true);
    await engine.sync();
    expect(engine.status.get()).toMatchObject({ label: 'Synced', queued: 0 });
    fake.failNext = { count: 1, status: 400 };
    await engine.data.create('hello', 'hello_notes', { n: 2 });
    await engine.sync();
    expect(engine.status.get()).toMatchObject({ label: 'Error', attention: 1 });
  });

  it('pushes data.changed to subscribers and data.sync_failed to the owning app', async () => {
    const { engine, fake, events } = setup();
    engine.subscribe('hello', 'hello_notes');
    engine.subscribe('other', 'core_people');
    const { record } = await engine.data.create('hello', 'hello_notes', { n: 1 });
    await engine.sync();
    expect(events.filter((e) => e.topic === 'data.changed').every((e) => e.appId === 'hello')).toBe(true);
    fake.editOnServer('hello_notes', record.id, { n: 9 });
    await engine.data.update('hello', 'hello_notes', record.id, { n: 2 });
    await engine.sync();
    expect(events.find((e) => e.topic === 'data.sync_failed')).toMatchObject({ appId: 'hello', payload: { status: 'conflict', recordId: record.id } });
  });

  it('catch-up pulls server changes into the mirror and notifies', async () => {
    const { engine, fake, events } = setup();
    engine.subscribe('hello', 'hello_notes');
    fake.apply({ opId: 'remote-op-0001', collection: 'hello_notes', recordId: 'remote000000001', op: 'create', payload: { n: 5 } });
    const changed = await engine.refresh('hello_notes');
    expect(changed).toEqual(['remote000000001']);
    expect(await engine.data.get('hello_notes', 'remote000000001')).toMatchObject({ n: 5, version: 1 });
    expect(events.at(-1)).toMatchObject({ topic: 'data.changed', payload: { ids: ['remote000000001'] } });
    expect(await engine.refresh('hello_notes')).toEqual([]);
  });

  it('pauses for auth and schema mismatches without losing writes', async () => {
    const { engine, fake } = setup();
    const onAuth = vi.fn();
    (engine as unknown as { deps: { onAuthError: () => void } }).deps.onAuthError = onAuth;
    await engine.data.create('hello', 'hello_notes', { n: 1 });
    fake.failNext = { count: 1, status: 401 };
    await engine.sync();
    expect(engine.status.get()).toMatchObject({ label: 'Error', paused: 'auth', queued: 1 });
    expect(onAuth).toHaveBeenCalled();
    engine.resumeAfterAuth();
    await engine.sync();
    expect(engine.status.get()).toMatchObject({ label: 'Synced', queued: 0 });
    engine.pauseForSchema(true);
    await engine.data.create('hello', 'hello_notes', { n: 2 });
    await engine.sync();
    expect(engine.status.get()).toMatchObject({ paused: 'schema', queued: 1 });
    expect(fake.liveRecords('hello_notes')).toHaveLength(1);
  });

  it('resolve() rebases a conflict and syncs it', async () => {
    const { engine, fake } = setup();
    const { record } = await engine.data.create('hello', 'hello_notes', { n: 1 });
    await engine.sync();
    fake.editOnServer('hello_notes', record.id, { n: 9 });
    await engine.data.update('hello', 'hello_notes', record.id, { n: 2 });
    await engine.sync();
    const [row] = engine.rows.get();
    await engine.resolve(row!.seq, 'retry');
    await engine.sync();
    expect(fake.records.get(`hello_notes/${record.id}`)).toMatchObject({ n: 2, version: 3 });
    expect(engine.status.get().label).toBe('Synced');
  });
});
