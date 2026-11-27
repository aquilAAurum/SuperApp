import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryKv } from './kv.ts';
import { SyncStore } from './store.ts';
import { DataService } from './data.ts';
import { SyncWorker, backoffMs } from './worker.ts';
import { resolveRow } from './resolve.ts';
import { FakeOpsServer } from '../../tests/support/fake-ops-server.ts';
import { newRecordId } from '../core/ids.ts';
import { quietLogger } from '../test-helpers.ts';
import { ShellError } from '../bridge/types.ts';

function setup(kv = new MemoryKv(), server = new FakeOpsServer()) {
  let t = 1_000_000;
  const now = () => t;
  const store = new SyncStore(kv);
  const changes: string[] = [];
  const failed: string[] = [];
  const data = new DataService(store, { newRecordId, newOpId: () => crypto.randomUUID(), now, onLocalChange: (c, ids) => changes.push(...ids.map((i) => `${c}/${i}`)) });
  const worker = new SyncWorker({ store, transport: server, logger: quietLogger().logger, now, random: () => 0.5, onFailed: (r) => failed.push(`${r.status}:${r.recordId}`) });
  return { kv, store, data, worker, server, changes, failed, advance: (ms: number) => (t += ms) };
}

describe('sync: write path', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('writes are local and pending immediately, then confirmed by the server', async () => {
    const { record, pending } = await s.data.create('hello', 'hello_notes', { text: 'hi' });
    expect(pending).toBe(true);
    expect(await s.data.get('hello_notes', record.id)).toMatchObject({ text: 'hi', version: 1 });
    expect((await s.worker.summary()).queued).toBe(1);
    await s.worker.run();
    expect((await s.worker.summary()).queued).toBe(0);
    expect(s.server.liveRecords('hello_notes')).toHaveLength(1);
    const e = await s.store.getEntry('hello_notes', record.id);
    expect(e).toMatchObject({ confirmedVersion: 1, pending: 0 });
  });

  it('M3: 100 writes made offline all reach the server after reconnect, with no duplicates', async () => {
    s.server.online = false;
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) ids.push((await s.data.create('hello', 'hello_notes', { n: i })).record.id);
    const r1 = await s.worker.run();
    expect(r1.offline).toBe(true);
    expect((await s.worker.summary()).queued).toBe(100);
    expect(s.server.liveRecords('hello_notes')).toHaveLength(0);

    s.server.online = true;
    await s.worker.run();
    expect((await s.worker.summary()).queued).toBe(0);
    const onServer = s.server.liveRecords('hello_notes');
    expect(onServer).toHaveLength(100);
    expect(new Set(onServer.map((r) => r.id))).toEqual(new Set(ids));
  });

  it('M3: killing the shell mid-sync loses nothing and duplicates nothing', async () => {
    const kv = new MemoryKv();
    const server = new FakeOpsServer();
    const a = setup(kv, server);
    for (let i = 0; i < 20; i++) await a.data.create('hello', 'hello_notes', { n: i });
    // The server applies the first op, but the shell "dies" before committing the result.
    const rows = await a.store.outbox();
    server.apply({ opId: rows[0]!.opId, collection: 'hello_notes', recordId: rows[0]!.recordId, op: 'create', payload: rows[0]!.payload });
    kv.failNextCommit = true;
    await a.worker.run().catch(() => undefined);

    // Restart: a new worker over the same durable store.
    const b = setup(kv, server);
    await b.worker.run();
    expect((await b.worker.summary()).queued).toBe(0);
    expect(server.liveRecords('hello_notes')).toHaveLength(20);
    expect([...server.processed.values()].filter((p) => p.status === 200)).toHaveLength(20);
  });

  it('keeps per-record order and computes baseVersion for chained offline edits', async () => {
    s.server.online = false;
    const { record } = await s.data.create('hello', 'hello_notes', { text: 'a' });
    await s.data.update('hello', 'hello_notes', record.id, { text: 'b' });
    await s.data.update('hello', 'hello_notes', record.id, { text: 'c' });
    expect(await s.data.get('hello_notes', record.id)).toMatchObject({ text: 'c', version: 3 });
    const rows = await s.store.outbox();
    expect(rows.map((r) => [r.op, r.baseVersion])).toEqual([['create', null], ['update', 1], ['update', 2]]);
    s.server.online = true;
    await s.worker.run();
    expect(s.server.liveRecords('hello_notes')[0]).toMatchObject({ text: 'c', version: 3 });
    expect(await s.store.getEntry('hello_notes', record.id)).toMatchObject({ confirmedVersion: 3, pending: 0 });
  });

  it('soft-deletes locally and on the server', async () => {
    const { record } = await s.data.create('hello', 'hello_notes', { text: 'x' });
    await s.data.delete('hello', 'hello_notes', record.id);
    expect(await s.data.get('hello_notes', record.id)).toBeNull();
    await s.worker.run();
    expect(s.server.records.get(`hello_notes/${record.id}`)).toMatchObject({ deleted: true, version: 2 });
  });

  it('rejects updates against a stale version and creates over an existing id', async () => {
    const { record } = await s.data.create('hello', 'hello_notes', { text: 'x' });
    await expect(s.data.update('hello', 'hello_notes', record.id, { text: 'y' }, 7)).rejects.toBeInstanceOf(ShellError);
    await expect(s.data.create('hello', 'hello_notes', {}, record.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(s.data.update('hello', 'hello_notes', 'nothere00000000', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('strips server-owned fields from subapp payloads', async () => {
    const { record } = await s.data.create('hello', 'hello_notes', { text: 'x', owner: 'evil', version: 99, deleted: true });
    expect(record).toMatchObject({ version: 1, deleted: false });
    expect(record.owner).toBeUndefined();
  });
});

describe('sync: failure handling', () => {
  it('5xx retries with exponential backoff and goes dead after 10 attempts', async () => {
    const s = setup();
    await s.data.create('hello', 'hello_notes', { text: 'x' });
    s.server.failNext = { count: 100, status: 503 };
    for (let i = 0; i < 9; i++) {
      await s.worker.run();
      const [row] = await s.store.outbox();
      expect(row).toMatchObject({ status: 'queued', attempts: i + 1 });
      s.advance(400_000);
    }
    await s.worker.run();
    expect((await s.store.outbox())[0]).toMatchObject({ status: 'dead', attempts: 10 });
    expect(s.failed).toHaveLength(1);
  });

  it('backoff grows from ~2 s to a 5 min cap', () => {
    expect(backoffMs(1, () => 1)).toBe(2_000);
    expect(backoffMs(2, () => 1)).toBe(4_000);
    expect(backoffMs(20, () => 1)).toBe(300_000);
    expect(backoffMs(1, () => 0)).toBe(1_000);
  });

  it('400 goes dead immediately with the server message', async () => {
    const s = setup();
    await s.data.create('hello', 'hello_notes', { text: 'x' });
    s.server.failNext = { count: 1, status: 400 };
    await s.worker.run();
    expect((await s.store.outbox())[0]).toMatchObject({ status: 'dead', lastError: 'injected failure' });
  });

  it('401 pauses the worker without consuming attempts', async () => {
    const s = setup();
    await s.data.create('hello', 'hello_notes', { text: 'x' });
    s.server.failNext = { count: 1, status: 401 };
    const r = await s.worker.run();
    expect(r.pausedForAuth).toBe(true);
    expect((await s.store.outbox())[0]).toMatchObject({ status: 'queued', attempts: 0 });
    expect((await s.worker.run()).sent).toBe(0);
    s.worker.resumeAfterAuth();
    await s.worker.run();
    expect(await s.store.outbox()).toHaveLength(0);
  });

  it('M3: a forced version conflict lands in Needs attention with both versions; server wins in the mirror', async () => {
    const s = setup();
    const { record } = await s.data.create('hello', 'hello_notes', { text: 'mine' });
    await s.worker.run();
    s.server.editOnServer('hello_notes', record.id, { text: 'theirs' });
    await s.data.update('hello', 'hello_notes', record.id, { text: 'mine v2' });
    await s.worker.run();
    const [row] = await s.store.outbox();
    expect(row).toMatchObject({ status: 'conflict', conflictKind: 'version', payload: { text: 'mine v2' }, server: { text: 'theirs', version: 2 } });
    expect(await s.data.get('hello_notes', record.id)).toMatchObject({ text: 'theirs', version: 2 });
    expect(s.failed).toEqual([`conflict:${record.id}`]);
  });

  it('later edits to a conflicted record wait behind it', async () => {
    const s = setup();
    const { record } = await s.data.create('hello', 'hello_notes', { text: 'a' });
    await s.worker.run();
    s.server.editOnServer('hello_notes', record.id, { text: 'server' });
    s.server.online = false;
    await s.data.update('hello', 'hello_notes', record.id, { text: 'b' });
    await s.data.update('hello', 'hello_notes', record.id, { text: 'c' });
    s.server.online = true;
    await s.worker.run();
    expect((await s.store.outbox()).map((r) => r.status)).toEqual(['conflict', 'queued']);
    expect(s.server.records.get(`hello_notes/${record.id}`)!.text).toBe('server');
  });
});

describe('sync: Needs attention actions', () => {
  async function conflicted() {
    const s = setup();
    const { record } = await s.data.create('hello', 'hello_notes', { text: 'a', keep: 1 });
    await s.worker.run();
    s.server.editOnServer('hello_notes', record.id, { text: 'server' });
    await s.data.update('hello', 'hello_notes', record.id, { text: 'mine' });
    await s.worker.run();
    const [row] = await s.store.outbox();
    const refetched: string[] = [];
    return { ...s, id: record.id, row: row!, deps: { newRecordId, newOpId: () => crypto.randomUUID(), refetch: (_c: string, id: string) => refetched.push(id) }, refetched };
  }

  it('retry re-applies my change on top of the server version', async () => {
    const c = await conflicted();
    await resolveRow(c.store, c.row.seq, 'retry', c.deps);
    expect((await c.store.outbox())[0]).toMatchObject({ status: 'queued', baseVersion: 2 });
    await c.worker.run();
    expect(c.server.records.get(`hello_notes/${c.id}`)).toMatchObject({ text: 'mine', version: 3 });
    expect(await c.data.get('hello_notes', c.id)).toMatchObject({ text: 'mine', version: 3 });
  });

  it('keep server version drops my change', async () => {
    const c = await conflicted();
    await resolveRow(c.store, c.row.seq, 'keep_server', c.deps);
    expect(await c.store.outbox()).toHaveLength(0);
    expect(await c.data.get('hello_notes', c.id)).toMatchObject({ text: 'server', version: 2 });
  });

  it('dead rows can be retried or discarded', async () => {
    const s = setup();
    const { record } = await s.data.create('hello', 'hello_notes', { text: 'x' });
    s.server.failNext = { count: 1, status: 400 };
    await s.worker.run();
    const [row] = await s.store.outbox();
    await resolveRow(s.store, row!.seq, 'retry', { newRecordId, newOpId: () => crypto.randomUUID(), refetch: () => undefined });
    await s.worker.run();
    expect(s.server.liveRecords('hello_notes')).toHaveLength(1);

    s.server.failNext = { count: 1, status: 400 };
    await s.data.update('hello', 'hello_notes', record.id, { text: 'bad' });
    await s.worker.run();
    const [dead] = await s.store.outbox();
    const refetched: string[] = [];
    await resolveRow(s.store, dead!.seq, 'discard', { newRecordId, newOpId: () => crypto.randomUUID(), refetch: (_c, id) => refetched.push(id) });
    expect(await s.store.outbox()).toHaveLength(0);
    expect(refetched).toEqual([record.id]);
  });

  it('a record deleted on the server can be recreated from my copy', async () => {
    const s = setup();
    const { record } = await s.data.create('hello', 'hello_notes', { text: 'x' });
    await s.worker.run();
    s.server.editOnServer('hello_notes', record.id, { deleted: true });
    await s.data.update('hello', 'hello_notes', record.id, { text: 'still mine' });
    await s.worker.run();
    const [row] = await s.store.outbox();
    expect(row).toMatchObject({ status: 'conflict', conflictKind: 'deleted_on_server' });
    await resolveRow(s.store, row!.seq, 'recreate', { newRecordId, newOpId: () => crypto.randomUUID(), refetch: () => undefined });
    await s.worker.run();
    const live = s.server.liveRecords('hello_notes');
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ text: 'still mine', version: 1 });
    expect(live[0]!.id).not.toBe(record.id);
  });
});

describe('sync: read path', () => {
  it('lists locally with filter, sort and paging; merges server records unless pending', async () => {
    const s = setup();
    await s.data.create('hello', 'hello_notes', { n: 2, tag: 'a' });
    await s.data.create('hello', 'hello_notes', { n: 1, tag: 'a' });
    await s.data.create('hello', 'hello_notes', { n: 3, tag: 'b' });
    const res = await s.data.list('hello_notes', { filter: "tag = 'a'", sort: '-n' });
    expect(res.items.map((r) => r.n)).toEqual([2, 1]);
    expect(res.pending).toBe(true);
    await expect(s.data.list('hello_notes', { filter: 'n > 1' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });

    await s.worker.run();
    const [first] = (await s.data.list('hello_notes', { sort: 'n' })).items;
    const remote = { ...s.server.editOnServer('hello_notes', first!.id, { n: 10 }) };
    expect(await s.data.applyServerRecords('hello_notes', [remote])).toEqual([first!.id]);
    expect(await s.data.get('hello_notes', first!.id)).toMatchObject({ n: 10, version: 2 });
    expect(await s.data.applyServerRecords('hello_notes', [remote])).toEqual([]);
  });
});
