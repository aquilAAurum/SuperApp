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
      'sys.capabilities': () => ({ apiVersion: '1.0', shellVersion: 'standalone', formFactor: 'phone', platform: 'web', methods: Object.keys(this.handlers), device: { location: false, contacts: false, haptics: false, battery: false, network: false, camera: false, notifications: false } }),
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
      ...overrides,
    };
  }

  connect(): Promise<WelcomeMessage> {
    return Promise.resolve({
      type: 'welcome',
      sessionToken: 'standalone',
      apiVersion: '1.0',
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
