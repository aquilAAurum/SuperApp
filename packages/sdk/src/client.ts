import { ENVELOPE_VERSION, DEFAULT_REQUEST_TIMEOUT_MS, HANDSHAKE_TIMEOUT_MS } from '@superapp/contracts/version';
import { isShellToApp, type EventEnvelope, type RequestEnvelope, type WelcomeMessage } from '@superapp/contracts/envelope';
import type { BridgeErrorBody, ErrorCode } from '@superapp/contracts/errors';

export const SDK_VERSION = '1.1.0';

export class BridgeError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  constructor(body: BridgeErrorBody) {
    super(body.message);
    this.name = 'BridgeError';
    this.code = body.code;
    this.retryable = body.retryable;
  }
}

export interface CallOptions {
  timeoutMs?: number;
}

/** Minimal window surface the SDK needs; injectable for tests. */
export interface HostWindow {
  parent: unknown;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
}

export interface Transport {
  readonly hosted: boolean;
  /** Resolves with the welcome once a session exists (hosted) or a synthetic one (standalone). */
  connect(): Promise<WelcomeMessage>;
  send(req: RequestEnvelope): void;
  onMessage(fn: (msg: unknown) => void): void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> };

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hosted transport: hello on window.parent, then everything over the private MessagePort the
 * shell transfers in its welcome (spec §Handshake). Window messages after the handshake are ignored.
 */
export class PortTransport implements Transport {
  readonly hosted = true;
  private port: MessagePort | null = null;
  private listeners: ((msg: unknown) => void)[] = [];

  constructor(
    private readonly appId: string,
    private readonly win: HostWindow,
    private readonly handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS,
  ) {}

  connect(): Promise<WelcomeMessage> {
    return new Promise((resolve, reject) => {
      const parent = this.win.parent as { postMessage(msg: unknown, origin: string): void };
      const timer = setTimeout(() => {
        this.win.removeEventListener('message', onWindowMessage);
        reject(new BridgeError({ code: 'TIMEOUT', message: 'Shell did not answer the handshake.', retryable: true }));
      }, this.handshakeTimeoutMs);

      const onWindowMessage = (e: MessageEvent) => {
        if (e.source !== this.win.parent) return; // only the shell may welcome us
        const data = e.data as Partial<WelcomeMessage> | null;
        if (!data || data.type !== 'welcome' || !e.ports[0] || typeof data.sessionToken !== 'string') return;
        clearTimeout(timer);
        this.win.removeEventListener('message', onWindowMessage);
        this.port = e.ports[0];
        this.port.onmessage = (ev) => {
          for (const l of this.listeners) l(ev.data);
        };
        resolve(data as WelcomeMessage);
      };

      this.win.addEventListener('message', onWindowMessage);
      // The sandboxed frame has an opaque origin and cannot name the shell's origin safely; the shell
      // authenticates the hello by event.source, not by origin.
      parent.postMessage({ type: 'hello', appId: this.appId, sdkVersion: SDK_VERSION }, '*');
    });
  }

  send(req: RequestEnvelope): void {
    if (!this.port) throw new BridgeError({ code: 'INTERNAL', message: 'Bridge not connected.', retryable: true });
    this.port.postMessage(req);
  }

  onMessage(fn: (msg: unknown) => void): void {
    this.listeners.push(fn);
  }
}

export class BridgeClient {
  private token = '';
  private pending = new Map<string, Pending>();
  private topicHandlers = new Map<string, Set<(payload: unknown, evt: EventEnvelope) => void>>();
  readonly ready: Promise<WelcomeMessage>;
  context: WelcomeMessage | null = null;

  constructor(private readonly transport: Transport) {
    transport.onMessage((m) => this.dispatch(m));
    this.ready = transport.connect().then((w) => {
      this.token = w.sessionToken;
      this.context = w;
      return w;
    });
  }

  get isHosted(): boolean {
    return this.transport.hosted;
  }

  /** RATE_LIMITED is retryable: back off and retry a few times before surfacing it (spec: 50 req/s per app). */
  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, opts: CallOptions = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.callOnce<T>(method, params, opts);
      } catch (err) {
        if (!(err instanceof BridgeError) || err.code !== 'RATE_LIMITED' || attempt >= 5) throw err;
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
    }
  }

  private async callOnce<T>(method: string, params: Record<string, unknown>, opts: CallOptions): Promise<T> {
    await this.ready;
    const id = newId();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError({ code: 'TIMEOUT', message: `${method} timed out after ${timeoutMs} ms`, retryable: true }));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.transport.send({ v: ENVELOPE_VERSION, id, kind: 'req', method, params, token: this.token });
    });
  }

  /** Subscribe to pushed events (`evt` envelopes) by topic. Returns an unsubscribe function. */
  onEvent(topic: string, handler: (payload: unknown, evt: EventEnvelope) => void): () => void {
    let set = this.topicHandlers.get(topic);
    if (!set) this.topicHandlers.set(topic, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }

  private dispatch(msg: unknown): void {
    if (!isShellToApp(msg)) return;
    if (msg.kind === 'res') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new BridgeError(msg.error));
      return;
    }
    for (const h of this.topicHandlers.get(msg.topic) ?? []) h(msg.payload, msg);
  }
}
