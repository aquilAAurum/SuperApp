/**
 * device.* handlers that are live before the rest of M4: Health Connect (ADR-010) and haptics.
 * Pure logic over a `DevicePort` (implemented by the CapabilityBroker), so it is unit-tested
 * without Android. Access is logged with app id, method and metric names, never with values
 * (HB-DATA-03: health readings are sensitive and stay out of logs).
 */
import {
  HEALTH_MAX_RANGE_DAYS,
  HEALTH_READ_METRICS,
  HEALTH_READ_PERMISSION,
  HEALTH_WRITE_PERMISSION,
  HEALTH_WRITE_TYPES,
  declaredScopes,
  type HealthBucket,
  type HealthReadMetric,
  type HealthStatus,
  type HealthUnavailableReason,
  type HealthWriteRecord,
  type HealthWriteType,
  type MethodName,
} from '@superapp/contracts';
import type { Logger } from '../core/logger.ts';
import { ShellError, type Handler } from './types.ts';

/** Native side, in Health Connect terms (permission names without the `android.permission.health.` prefix). */
export interface HealthPort {
  status(): Promise<{ available: boolean; reason?: HealthUnavailableReason; granted: string[] }>;
  requestPermissions(permissions: string[]): Promise<string[]>;
  aggregate(metrics: HealthReadMetric[], start: string, end: string, bucket: 'day' | 'none'): Promise<HealthBucket[]>;
  insert(records: HealthWriteRecord[]): Promise<number>;
  delete(type: HealthWriteType, clientIds: string[]): Promise<number>;
}

export interface DevicePort {
  health: HealthPort;
  haptics(style: 'light' | 'medium' | 'heavy'): Promise<void>;
}

export function toStatus(s: { available: boolean; reason?: HealthUnavailableReason; granted: string[] }): HealthStatus {
  const g = new Set(s.granted);
  return {
    available: s.available,
    ...(s.reason ? { reason: s.reason } : {}),
    granted: {
      read: HEALTH_READ_METRICS.filter((m) => g.has(HEALTH_READ_PERMISSION[m])),
      write: HEALTH_WRITE_TYPES.filter((t) => g.has(HEALTH_WRITE_PERMISSION[t])),
    },
  };
}

export function deviceHandlers(port: DevicePort, logger: Logger): Partial<Record<MethodName, Handler>> {
  const available = async (): Promise<HealthStatus> => {
    const st = toStatus(await port.health.status());
    if (!st.available) throw new ShellError('UNAVAILABLE', `Health Connect is not available on this device (${st.reason ?? 'unsupported'}).`);
    return st;
  };

  return {
    'device.haptics': async (_ctx, p) => {
      await port.haptics((p.style as 'light' | 'medium' | 'heavy' | undefined) ?? 'light');
      return {};
    },

    'device.health.status': async ({ manifest }) => {
      const declared = declaredScopes(manifest);
      if (!declared.has('device.health.read') && !declared.has('device.health.write')) {
        throw new ShellError('SCOPE_DENIED', 'Scope device.health.read: not_declared.');
      }
      return toStatus(await port.health.status());
    },

    'device.health.request': async ({ appId }, p) => {
      await available();
      const read = (p.read as HealthReadMetric[] | undefined) ?? [];
      const write = (p.write as HealthWriteType[] | undefined) ?? [];
      const perms = [...read.map((m) => HEALTH_READ_PERMISSION[m]), ...write.map((t) => HEALTH_WRITE_PERMISSION[t])];
      if (perms.length) await port.health.requestPermissions(perms);
      const st = toStatus(await port.health.status());
      logger.info('health.request', { appId, read, write, grantedRead: st.granted.read.length, grantedWrite: st.granted.write.length });
      return st;
    },

    'device.health.read': async ({ appId }, p) => {
      const start = Date.parse(String(p.start));
      const end = Date.parse(String(p.end));
      if (!(end > start)) throw new ShellError('INVALID_PARAMS', 'end must be after start.');
      if (end - start > HEALTH_MAX_RANGE_DAYS * 86_400_000) throw new ShellError('INVALID_PARAMS', `A read may cover at most ${HEALTH_MAX_RANGE_DAYS} days.`);
      const st = await available();
      const metrics = p.metrics as HealthReadMetric[];
      const granted = metrics.filter((m) => st.granted.read.includes(m));
      const missing = metrics.filter((m) => !st.granted.read.includes(m));
      const bucket = (p.bucket as 'day' | 'none' | undefined) ?? 'day';
      const buckets = granted.length ? await port.health.aggregate(granted, String(p.start), String(p.end), bucket) : [];
      logger.info('health.read', { appId, metrics: granted, missing, bucket, days: Math.ceil((end - start) / 86_400_000) });
      return { buckets: buckets.map((b) => ({ ...b, values: pick(b.values, granted) })), missing };
    },

    'device.health.write': async ({ appId }, p) => {
      const st = await available();
      const records = p.records as HealthWriteRecord[];
      for (const r of records) {
        const [a, b] = r.type === 'weight' ? [r.time, r.time] : [r.start, r.end];
        if (Date.parse(b) < Date.parse(a)) throw new ShellError('INVALID_PARAMS', 'end must not be before start.');
      }
      const allowed = records.filter((r) => st.granted.write.includes(r.type));
      const missing = [...new Set(records.map((r) => r.type).filter((t) => !st.granted.write.includes(t)))];
      const written = allowed.length ? await port.health.insert(allowed) : 0;
      logger.info('health.write', { appId, written, types: [...new Set(allowed.map((r) => r.type))], missing });
      return { written, missing };
    },

    'device.health.delete': async ({ appId }, p) => {
      const st = await available();
      const type = p.type as HealthWriteType;
      if (!st.granted.write.includes(type)) return { deleted: 0 };
      const deleted = await port.health.delete(type, p.clientIds as string[]);
      logger.info('health.delete', { appId, type, deleted });
      return { deleted };
    },
  };
}

function pick(values: HealthBucket['values'], keep: HealthReadMetric[]): HealthBucket['values'] {
  const out: HealthBucket['values'] = {};
  for (const k of keep) {
    const v = values[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}
