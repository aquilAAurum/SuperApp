import { describe, expect, it } from 'vitest';
import type { HealthBucket, HealthReadMetric, HealthWriteRecord } from '@superapp/contracts';
import { deviceHandlers, type DevicePort } from './device-handlers.ts';
import { ShellError } from './types.ts';
import { manifest, quietLogger } from '../test-helpers.ts';

function fakePort(granted: string[] = [], available = true) {
  const calls: { aggregate: unknown[]; insert: HealthWriteRecord[][]; requested: string[][] } = { aggregate: [], insert: [], requested: [] };
  const port: DevicePort = {
    haptics: async () => undefined,
    health: {
      status: async () => (available ? { available, granted } : { available, reason: 'not_installed', granted: [] }),
      requestPermissions: async (perms) => {
        calls.requested.push(perms);
        granted.push(...perms);
        return granted;
      },
      aggregate: async (metrics: HealthReadMetric[], start, end, bucket) => {
        calls.aggregate.push({ metrics, start, end, bucket });
        const b: HealthBucket = { start, end, values: { steps: 8421, weight: 81.2, activeCalories: Number.NaN } };
        return [b];
      },
      insert: async (records) => {
        calls.insert.push(records);
        return records.length;
      },
      delete: async (_t, ids) => ids.length,
    },
  };
  return { port, calls };
}

const ctx = { appId: 'eatwell', manifest: manifest({ id: 'eatwell', scopes: { required: ['data.own'], optional: ['device.health.read', 'device.health.write'] } }) };
const T0 = '2026-11-28T00:00:00-05:00';
const T1 = '2026-11-29T00:00:00-05:00';

describe('device.health handlers', () => {
  it('maps Health Connect permissions to contract names', async () => {
    const { port } = fakePort(['READ_STEPS', 'WRITE_NUTRITION', 'READ_SOMETHING_ELSE']);
    const h = deviceHandlers(port, quietLogger().logger);
    expect(await h['device.health.status']!(ctx, {})).toEqual({ available: true, granted: { read: ['steps'], write: ['nutrition'] } });
  });

  it('status needs the scope declared', async () => {
    const h = deviceHandlers(fakePort().port, quietLogger().logger);
    await expect(Promise.resolve(h['device.health.status']!({ appId: 'hello', manifest: manifest() }, {}))).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('requests exactly the permissions asked for', async () => {
    const { port, calls } = fakePort();
    const h = deviceHandlers(port, quietLogger().logger);
    const st = await h['device.health.request']!(ctx, { read: ['steps', 'weight'], write: ['nutrition'] });
    expect(calls.requested).toEqual([['READ_STEPS', 'READ_WEIGHT', 'WRITE_NUTRITION']]);
    expect(st).toMatchObject({ granted: { read: ['steps', 'weight'], write: ['nutrition'] } });
  });

  it('reads only granted metrics, reports the rest as missing, drops non-numbers', async () => {
    const { port, calls } = fakePort(['READ_STEPS']);
    const h = deviceHandlers(port, quietLogger().logger);
    const res = await h['device.health.read']!(ctx, { metrics: ['steps', 'weight'], start: T0, end: T1 });
    expect(calls.aggregate).toEqual([{ metrics: ['steps'], start: T0, end: T1, bucket: 'day' }]);
    expect(res).toEqual({ buckets: [{ start: T0, end: T1, values: { steps: 8421 } }], missing: ['weight'] });
  });

  it('never logs health values', async () => {
    const { logger, lines } = quietLogger();
    const h = deviceHandlers(fakePort(['READ_STEPS', 'READ_WEIGHT']).port, logger);
    await h['device.health.read']!(ctx, { metrics: ['steps', 'weight'], start: T0, end: T1 });
    expect(JSON.stringify(lines)).not.toMatch(/8421|81\.2/);
    expect(lines.some((l) => l.msg === 'health.read' && l.appId === 'eatwell')).toBe(true);
  });

  it('rejects inverted or oversized ranges', async () => {
    const h = deviceHandlers(fakePort(['READ_STEPS']).port, quietLogger().logger);
    await expect(Promise.resolve(h['device.health.read']!(ctx, { metrics: ['steps'], start: T1, end: T0 }))).rejects.toBeInstanceOf(ShellError);
    await expect(Promise.resolve(h['device.health.read']!(ctx, { metrics: ['steps'], start: '2024-01-01T00:00:00Z', end: T1 }))).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('answers UNAVAILABLE when Health Connect is missing', async () => {
    const h = deviceHandlers(fakePort([], false).port, quietLogger().logger);
    await expect(Promise.resolve(h['device.health.read']!(ctx, { metrics: ['steps'], start: T0, end: T1 }))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('writes only granted types and reports the others', async () => {
    const { port, calls } = fakePort(['WRITE_NUTRITION']);
    const h = deviceHandlers(port, quietLogger().logger);
    const meal: HealthWriteRecord = { type: 'nutrition', clientId: 'e1', start: T0, end: T0, energyKcal: 420 };
    const res = await h['device.health.write']!(ctx, { records: [meal, { type: 'weight', clientId: 'w1', time: T0, kg: 80 }] });
    expect(res).toEqual({ written: 1, missing: ['weight'] });
    expect(calls.insert).toEqual([[meal]]);
    expect(await h['device.health.delete']!(ctx, { type: 'weight', clientIds: ['w1'] })).toEqual({ deleted: 0 });
    expect(await h['device.health.delete']!(ctx, { type: 'nutrition', clientIds: ['e1'] })).toEqual({ deleted: 1 });
  });
});
