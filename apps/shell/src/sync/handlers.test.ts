import { describe, expect, it } from 'vitest';
import { MemoryKv } from './kv.ts';
import { SyncEngine } from './engine.ts';
import { dataHandlers } from './handlers.ts';
import { quietLogger, manifest } from '../test-helpers.ts';
import { ShellError } from '../bridge/types.ts';

function setup() {
  const engine = new SyncEngine({
    kv: new MemoryKv(),
    logger: quietLogger().logger,
    deviceId: () => null,
    emit: () => undefined,
    server: { sendOp: async () => ({ kind: 'offline' }), listSince: async () => [], getRecord: async () => null },
  });
  const h = dataHandlers(engine);
  const ctx = (appId: string) => ({ appId, manifest: manifest({ id: appId }) });
  return { engine, h, ctx };
}

const item = (source_app: string) => ({ kind: 'task', title: 'Call Ada', start: '2026-11-28', source_app });

describe('shared core collections are app-owned per record (ADR-011)', () => {
  it('lets an app create, update and delete its own agenda items', async () => {
    const { h, ctx } = setup();
    const { record } = (await h['data.create']!(ctx('contacts'), { collection: 'core_agenda', data: item('contacts') })) as { record: { id: string } };
    await expect(h['data.update']!(ctx('contacts'), { collection: 'core_agenda', id: record.id, data: { status: 'done' } })).resolves.toBeTruthy();
    await expect(h['data.delete']!(ctx('contacts'), { collection: 'core_agenda', id: record.id })).resolves.toBeTruthy();
  });

  it('refuses items claiming another app, and changes to another app\'s items', async () => {
    const { h, ctx } = setup();
    await expect(h['data.create']!(ctx('hello'), { collection: 'core_agenda', data: item('contacts') })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await expect(h['data.create']!(ctx('hello'), { collection: 'core_agenda', data: { kind: 'task', title: 'x', start: '2026-11-28' } })).rejects.toBeInstanceOf(ShellError);
    const { record } = (await h['data.create']!(ctx('contacts'), { collection: 'core_agenda', data: item('contacts') })) as { record: { id: string } };
    await expect(h['data.update']!(ctx('hello'), { collection: 'core_agenda', id: record.id, data: { title: 'hijack' } })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await expect(h['data.update']!(ctx('contacts'), { collection: 'core_agenda', id: record.id, data: { source_app: 'hello' } })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await expect(h['data.delete']!(ctx('hello'), { collection: 'core_agenda', id: record.id })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('applies the same rule to glances (app_id)', async () => {
    const { h, ctx } = setup();
    const g = { app_id: 'eatwell', key: 'intake', date: '2026-11-28', title: 'Eaten today', value: 1200 };
    await expect(h['data.create']!(ctx('hello'), { collection: 'core_glances', data: g })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await expect(h['data.create']!(ctx('eatwell'), { collection: 'core_glances', data: g })).resolves.toBeTruthy();
  });

  it('leaves other collections alone', async () => {
    const { h, ctx } = setup();
    await expect(h['data.create']!(ctx('hello'), { collection: 'hello_notes', data: { text: 'hi' } })).resolves.toBeTruthy();
  });
});
