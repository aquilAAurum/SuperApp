import { describe, expect, it } from 'vitest';
import { MemoryKv } from '../sync/kv.ts';
import { SyncEngine } from '../sync/engine.ts';
import { quietLogger } from '../test-helpers.ts';
import { TodayService, PREF_TODAY_HEALTH } from './service.ts';
import type { HealthPort } from '../bridge/device-handlers.ts';
import type { AgendaItem } from './agenda.ts';

function setup(opts: { native?: boolean; granted?: string[] } = {}) {
  const engine = new SyncEngine({
    kv: new MemoryKv(),
    logger: quietLogger().logger,
    deviceId: () => null,
    emit: () => undefined,
    server: { sendOp: async () => ({ kind: 'offline' }), listSince: async () => [], getRecord: async () => null },
  });
  const prefs = new Map<string, string>();
  const reads: string[][] = [];
  const health: HealthPort = {
    status: async () => ({ available: true, granted: opts.granted ?? ['READ_STEPS', 'READ_ACTIVE_CALORIES_BURNED'] }),
    requestPermissions: async () => [],
    aggregate: async (metrics) => {
      reads.push([...metrics]);
      return [{ start: 's', end: 'e', values: { steps: 6543, activeCalories: 321 } }];
    },
    insert: async () => 0,
    delete: async () => 0,
  };
  const today = new TodayService({
    sync: engine,
    health,
    isNative: () => opts.native ?? true,
    getPref: async (k) => prefs.get(k) ?? null,
    setPref: async (k, v) => void prefs.set(k, v),
    logger: quietLogger().logger,
    now: () => new Date(2026, 10, 28, 10, 2),
  });
  return { engine, today, prefs, reads };
}

describe('TodayService', () => {
  it('quick-adds timed and all-day items as the shell, visible after reload', async () => {
    const { today } = setup();
    await today.quickAdd({ title: ' Dentist ', kind: 'event', day: '2026-11-30', timeMin: 9 * 60 + 30, durationMin: 45 });
    await today.quickAdd({ title: 'Pay rent', kind: 'task', day: '2026-11-28', timeMin: null, durationMin: 0 });
    await today.reload();
    const items = today.items.get();
    expect(items.find((i) => i.title === 'Dentist')).toMatchObject({ kind: 'event', start: '2026-11-30T09:30', end: '2026-11-30T10:15', all_day: false, source_app: 'shell', status: 'open' });
    expect(items.find((i) => i.title === 'Pay rent')).toMatchObject({ start: '2026-11-28', all_day: true, end: '' });
    await expect(today.quickAdd({ title: '  ', kind: 'task', day: '2026-11-28', timeMin: null, durationMin: 0 })).rejects.toThrow('title');
  });

  it('protects a focus window as a focus block today', async () => {
    const { today } = setup();
    await today.startFocus(605, 750);
    await today.reload();
    expect(today.items.get()[0]).toMatchObject({ kind: 'focus', title: 'Focus', start: '2026-11-28T10:05', end: '2026-11-28T12:30' });
  });

  it('completes and removes only its own items', async () => {
    const { today, engine } = setup();
    await today.quickAdd({ title: 'Mine', kind: 'task', day: '2026-11-28', timeMin: null, durationMin: 0 });
    await engine.data.create('contacts', 'core_agenda', { kind: 'task', title: 'Reach out to Ada', start: '2026-11-28', source_app: 'contacts', status: 'open' });
    await today.reload();
    const mine = today.items.get().find((i) => i.title === 'Mine') as AgendaItem;
    const theirs = today.items.get().find((i) => i.title === 'Reach out to Ada') as AgendaItem;
    await today.toggleDone(mine);
    await today.toggleDone(theirs);
    await today.remove(theirs);
    await today.reload();
    expect(today.items.get().find((i) => i.id === mine.id)?.status).toBe('done');
    expect(today.items.get().find((i) => i.id === theirs.id)).toMatchObject({ status: 'open' });
  });

  it('reads health only after opt-in, only granted metrics, and never stores it', async () => {
    const { today, prefs, reads, engine } = setup({ granted: ['READ_STEPS'] });
    await today.loadHealth();
    expect(today.health.get()).toBeNull();
    expect(reads).toEqual([]);
    await today.setHealthEnabled(true);
    expect(prefs.get(PREF_TODAY_HEALTH)).toBe('1');
    expect(reads).toEqual([['steps']]);
    expect(today.health.get()).toEqual({ steps: 6543, activeCalories: 321 });
    expect((await engine.store.kv.list('mirror')).length).toBe(0);
    await today.setHealthEnabled(false);
    expect(today.health.get()).toBeNull();
  });

  it('never reads health on the web build', async () => {
    const { today, reads } = setup({ native: false });
    await today.setHealthEnabled(true);
    expect(reads).toEqual([]);
    expect(today.health.get()).toBeNull();
  });
});
