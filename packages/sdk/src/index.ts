import type { Capabilities } from '@superapp/contracts/capabilities';
import type { WelcomeMessage } from '@superapp/contracts/envelope';
import { BridgeClient, PortTransport, type CallOptions, type HostWindow, type Transport } from './client.ts';
import { StandaloneTransport } from './standalone.ts';

export { BridgeClient, BridgeError, PortTransport, SDK_VERSION, type CallOptions, type Transport } from './client.ts';
export { StandaloneTransport } from './standalone.ts';
export type { Capabilities, WelcomeMessage };

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
  };
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
