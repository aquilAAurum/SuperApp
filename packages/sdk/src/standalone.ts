import { ENVELOPE_VERSION } from '@superapp/contracts/version';
import type { RequestEnvelope, ResponseEnvelope, WelcomeMessage } from '@superapp/contracts/envelope';
import type { ErrorCode } from '@superapp/contracts/errors';
import type { Transport } from './client.ts';

type Handler = (params: Record<string, unknown>) => unknown;

/**
 * Standalone mode (spec §SDK requirements): when a subapp runs in a normal browser (Vite dev
 * server) there is no shell. Calls are answered by an in-memory dev mock so the app is usable.
 * `sa.isHosted === false` tells the app which mode it is in.
 */
export class StandaloneTransport implements Transport {
  readonly hosted = false;
  private listeners: ((msg: unknown) => void)[] = [];
  private records = new Map<string, Map<string, Record<string, unknown>>>();
  private handlers: Record<string, Handler>;
  private hcRead: string[] = [];
  private hcWrite: string[] = [];

  constructor(appId: string, overrides: Record<string, Handler> = {}) {
    const table = (c: unknown) => {
      const key = String(c);
      let t = this.records.get(key);
      if (!t) this.records.set(key, (t = new Map()));
      return t;
    };
    this.handlers = {
      'app.ready': () => ({}),
      'app.setTitle': (p) => {
        if (typeof document !== 'undefined') document.title = String(p.title);
        return {};
      },
      'app.close': () => ({}),
      'app.getContext': () => ({ appId, route: '/', hosted: false }),
      'sys.capabilities': () => ({ apiVersion: '1.1', shellVersion: 'standalone', formFactor: 'phone', platform: 'web', methods: Object.keys(this.handlers), device: { location: false, contacts: false, haptics: false, battery: false, network: false, camera: false, notifications: false, health: true } }),
      'sys.log': (p) => {
        console.log(JSON.stringify({ ts: new Date().toISOString(), appId, ...p }));
        return {};
      },
      'data.list': (p) => ({ items: [...table(p.collection).values()], pending: false }),
      'data.get': (p) => table(p.collection).get(String(p.id)) ?? null,
      'data.create': (p) => {
        const id = String(p.id ?? Math.random().toString(36).slice(2, 17).padEnd(15, '0'));
        const rec = { ...(p.data as object), id, version: 1 };
        table(p.collection).set(id, rec);
        return { record: rec, pending: false };
      },
      'data.update': (p) => {
        const prev = table(p.collection).get(String(p.id));
        if (!prev) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });
        const rec = { ...prev, ...(p.data as object), version: Number(prev.version) + 1 };
        table(p.collection).set(String(p.id), rec);
        return { record: rec, pending: false };
      },
      'data.delete': (p) => ({ deleted: table(p.collection).delete(String(p.id)), pending: false }),
      'data.subscribe': () => ({ subscriptionId: 'standalone' }),
      'data.unsubscribe': () => ({ ok: true }),
      'device.haptics': () => ({}),
      // Dev mock for Health Connect: stable fake activity per day so screens are usable in a browser.
      'device.health.status': () => ({ available: true, granted: { read: this.hcRead, write: this.hcWrite } }),
      'device.health.request': (p) => {
        this.hcRead = [...new Set([...this.hcRead, ...((p.read as string[]) ?? [])])];
        this.hcWrite = [...new Set([...this.hcWrite, ...((p.write as string[]) ?? [])])];
        return { available: true, granted: { read: this.hcRead, write: this.hcWrite } };
      },
      'device.health.read': (p) => {
        const metrics = p.metrics as string[];
        const start = new Date(String(p.start));
        const end = new Date(String(p.end));
        const days: { start: Date; end: Date }[] = [];
        if (p.bucket === 'none') days.push({ start, end });
        else for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push({ start: d, end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) });
        const fake = (m: string, t: Date) => {
          const seed = Math.abs(Math.sin(Math.floor(t.getTime() / 864e5) * 9301 + m.length * 49297));
          return ({ steps: 3000 + seed * 9000, distance: 2500 + seed * 6000, activeCalories: 150 + seed * 450, totalCalories: 1900 + seed * 700, exerciseMinutes: seed * 60, sleepMinutes: 360 + seed * 120, restingHeartRate: 58 + seed * 8 } as Record<string, number>)[m];
        };
        const granted = metrics.filter((m) => this.hcRead.includes(m));
        return {
          buckets: days.map((d) => ({ start: d.start.toISOString(), end: d.end.toISOString(), values: Object.fromEntries(granted.map((m) => [m, fake(m, d.start)]).filter(([, v]) => v !== undefined).map(([m, v]) => [m, Math.round(Number(v))])) })),
          missing: metrics.filter((m) => !this.hcRead.includes(m)),
        };
      },
      'device.health.write': (p) => {
        const recs = p.records as { type: string }[];
        const ok = recs.filter((r) => this.hcWrite.includes(r.type));
        return { written: ok.length, missing: [...new Set(recs.map((r) => r.type).filter((t) => !this.hcWrite.includes(t)))] };
      },
      'device.health.delete': (p) => ({ deleted: (p.clientIds as string[]).length }),
      ...overrides,
    };
  }

  connect(): Promise<WelcomeMessage> {
    return Promise.resolve({
      type: 'welcome',
      sessionToken: 'standalone',
      apiVersion: '1.1',
      grantedScopes: [],
      user: null,
      device: { id: null, kind: 'phone', name: 'Browser (standalone)' },
      formFactor: 'phone',
      theme: typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      locale: typeof navigator === 'undefined' ? 'en' : navigator.language,
    });
  }

  send(req: RequestEnvelope): void {
    if (['data.create', 'data.update', 'data.delete'].includes(req.method)) {
      const collection = req.params.collection;
      queueMicrotask(() => queueMicrotask(() => this.listeners.forEach((l) => l({ v: ENVELOPE_VERSION, kind: 'evt', topic: 'data.changed', payload: { collection }, ts: new Date().toISOString() }))));
    }
    const reply = (res: ResponseEnvelope) => queueMicrotask(() => this.listeners.forEach((l) => l(res)));
    const handler = this.handlers[req.method];
    if (!handler) {
      reply({ v: ENVELOPE_VERSION, id: req.id, kind: 'res', ok: false, error: { code: 'UNAVAILABLE', message: `${req.method} is not available standalone`, retryable: false } });
      return;
    }
    try {
      reply({ v: ENVELOPE_VERSION, id: req.id, kind: 'res', ok: true, result: handler(req.params) });
    } catch (err) {
      const code = ((err as { code?: ErrorCode }).code ?? 'INTERNAL') as ErrorCode;
      reply({ v: ENVELOPE_VERSION, id: req.id, kind: 'res', ok: false, error: { code, message: (err as Error).message, retryable: false } });
    }
  }

  onMessage(fn: (msg: unknown) => void): void {
    this.listeners.push(fn);
  }
}
