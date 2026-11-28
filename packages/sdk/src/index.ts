import type { Capabilities } from '@superapp/contracts/capabilities';
import type { WelcomeMessage } from '@superapp/contracts/envelope';
import type { HealthReadMetric, HealthReadResult, HealthStatus, HealthWriteRecord, HealthWriteResult, HealthWriteType } from '@superapp/contracts/health';
import { BridgeClient, PortTransport, type CallOptions, type HostWindow, type Transport } from './client.ts';
import { StandaloneTransport } from './standalone.ts';

export { BridgeClient, BridgeError, PortTransport, SDK_VERSION, type CallOptions, type Transport } from './client.ts';
export { StandaloneTransport } from './standalone.ts';
export type { Capabilities, WelcomeMessage };
export type { HealthBucket, HealthReadMetric, HealthReadResult, HealthStatus, HealthWriteRecord, HealthWriteResult, HealthWriteType, HealthMealType } from '@superapp/contracts/health';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ConnectOptions {
  appId: string;
  /** Override the transport (tests). Defaults to the shell port when framed, else standalone mock. */
  transport?: Transport;
  /** Forward uncaught errors and unhandled rejections via sys.log (default true). */
  captureErrors?: boolean;
}

export interface SuperApp {
  readonly isHosted: boolean;
  readonly ready: Promise<WelcomeMessage>;
  readonly context: WelcomeMessage | null;
  call<T = unknown>(method: string, params?: Record<string, unknown>, opts?: CallOptions): Promise<T>;
  on(topic: string, handler: (payload: unknown) => void): () => void;
  app: {
    ready(): Promise<void>;
    setTitle(title: string): Promise<void>;
    close(): Promise<void>;
    getContext(): Promise<{ appId: string; route: string; hosted: boolean }>;
  };
  sys: {
    capabilities(): Promise<Capabilities>;
    log(level: LogLevel, msg: string, fields?: Record<string, unknown>): Promise<void>;
  };
  data: {
    list<T = Record<string, unknown>>(collection: string, q?: { filter?: string; sort?: string; page?: number; perPage?: number }): Promise<{ items: T[]; pending: boolean }>;
    get<T = Record<string, unknown>>(collection: string, id: string): Promise<T | null>;
    create<T = Record<string, unknown>>(collection: string, data: Record<string, unknown>, id?: string): Promise<{ record: T; pending: boolean }>;
    update<T = Record<string, unknown>>(collection: string, id: string, data: Record<string, unknown>, baseVersion?: number): Promise<{ record: T; pending: boolean }>;
    delete(collection: string, id: string): Promise<{ pending: boolean }>;
    /**
     * Local results immediately, then again whenever the collection changes (server confirmation,
     * catch-up, realtime, or another app's write). Returns an unsubscribe function.
     */
    subscribe<T = Record<string, unknown>>(collection: string, onItems: (items: T[]) => void, q?: { filter?: string; sort?: string }): Promise<() => void>;
    /** A write from this app was dead-lettered or conflicted; the owner resolves it in the Sync centre. */
    onSyncFailed(handler: (e: { collection: string; recordId: string; status: 'dead' | 'conflict'; error: string | null }) => void): () => void;
  };
  device: {
    haptics(style?: 'light' | 'medium' | 'heavy'): Promise<void>;
    /** Health Connect through the shell (ADR-010). Declare device.health.read / .write in app.json. */
    health: {
      /** Availability and the Health Connect permissions the shell holds. No consent sheet. */
      status(): Promise<HealthStatus>;
      /** Shows the shell consent sheet (first time) and then Health Connect's permission dialog. */
      request(q: { read?: HealthReadMetric[]; write?: HealthWriteType[] }): Promise<HealthStatus>;
      /** Aggregates per local day (bucket 'day', default) or over the whole range ('none'). */
      read(metrics: HealthReadMetric[], start: Date | string, end: Date | string, bucket?: 'day' | 'none'): Promise<HealthReadResult>;
      /** Upserts by clientId (use the app's record id, so edits replace instead of duplicating). */
      write(records: HealthWriteRecord[]): Promise<HealthWriteResult>;
      delete(type: HealthWriteType, clientIds: string[]): Promise<{ deleted: number }>;
    };
  };
}

/** ISO instant with the local offset, so day buckets follow the owner's clock, not UTC. */
export function isoLocal(d: Date): string {
  const p = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? '+' : '-'}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
}

function isFramed(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window;
  } catch {
    return true;
  }
}

export function connect(opts: ConnectOptions): SuperApp {
  const transport =
    opts.transport ?? (isFramed() ? new PortTransport(opts.appId, window as unknown as HostWindow) : new StandaloneTransport(opts.appId));
  const client = new BridgeClient(transport);
  const call = client.call.bind(client);
  const done = async (p: Promise<unknown>) => {
    await p;
  };

  const sa: SuperApp = {
    get isHosted() {
      return client.isHosted;
    },
    ready: client.ready,
    get context() {
      return client.context;
    },
    call,
    on: (topic, handler) => client.onEvent(topic, handler),
    app: {
      ready: () => done(call('app.ready')),
      setTitle: (title) => done(call('app.setTitle', { title })),
      close: () => done(call('app.close')),
      getContext: () => call('app.getContext'),
    },
    sys: {
      capabilities: () => call('sys.capabilities'),
      log: (level, msg, fields) => done(call('sys.log', fields ? { level, msg, fields } : { level, msg })),
    },
    data: {
      list: (collection, q = {}) => call('data.list', { collection, ...q }),
      get: (collection, id) => call('data.get', { collection, id }),
      create: (collection, data, id) => call('data.create', id ? { collection, data, id } : { collection, data }),
      update: (collection, id, data, baseVersion) => call('data.update', baseVersion ? { collection, id, data, baseVersion } : { collection, id, data }),
      delete: (collection, id) => call('data.delete', { collection, id }),
      subscribe: async <T,>(collection: string, onItems: (items: T[]) => void, q: { filter?: string; sort?: string } = {}) => {
        const load = async () => onItems((await call<{ items: T[] }>('data.list', { collection, ...q, perPage: 500 })).items);
        // Coalesce bursts of change events (e.g. 100 writes) into one reload.
        let timer: ReturnType<typeof setTimeout> | null = null;
        const off = client.onEvent('data.changed', (p) => {
          if ((p as { collection?: string }).collection !== collection) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            void load().catch(() => undefined);
          }, 50);
        });
        const { subscriptionId } = await call<{ subscriptionId: string }>('data.subscribe', { collection });
        await load();
        return () => {
          if (timer) clearTimeout(timer);
          off();
          void call('data.unsubscribe', { subscriptionId }).catch(() => undefined);
        };
      },
      onSyncFailed: (handler) => client.onEvent('data.sync_failed', (p) => handler(p as Parameters<typeof handler>[0])),
    },
    device: {
      haptics: (style = 'light') => done(call('device.haptics', { style })),
      health: {
        status: () => call('device.health.status'),
        request: (q) => call('device.health.request', q),
        read: (metrics, start, end, bucket = 'day') =>
          call('device.health.read', { metrics, start: typeof start === 'string' ? start : isoLocal(start), end: typeof end === 'string' ? end : isoLocal(end), bucket }),
        write: (records) => call('device.health.write', { records }),
        delete: (type, clientIds) => call('device.health.delete', { type, clientIds }),
      },
    },
  };

  if (opts.captureErrors !== false && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const forward = (msg: string, fields: Record<string, unknown>) => {
      sa.sys.log('error', msg.slice(0, 200), fields).catch(() => undefined);
    };
    window.addEventListener('error', (e) => forward('uncaught_error', { message: String(e.message).slice(0, 500) }));
    window.addEventListener('unhandledrejection', (e) => forward('unhandled_rejection', { reason: String((e as PromiseRejectionEvent).reason).slice(0, 500) }));
  }

  return sa;
}
