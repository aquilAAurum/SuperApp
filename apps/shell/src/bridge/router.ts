import {
  DEFAULT_RATE_LIMIT_PER_SECOND,
  ENVELOPE_VERSION,
  METHODS,
  bridgeError,
  isMethodName,
  parseRequest,
  type ErrorCode,
  type EventEnvelope,
  type MethodName,
  type ResponseEnvelope,
} from '@superapp/contracts';
import { compileParamValidators, describeAjvError } from '@superapp/contracts/schemas';
import type { Logger } from '../core/logger.ts';
import { RingLog } from '../core/observable.ts';
import { safeEqual } from '../core/ids.ts';
import { RateLimiter } from './rate-limit.ts';
import { checkScope, type GrantStore } from './permissions.ts';
import { ShellError, type Handler, type InspectorEntry, type Rejection, type Session } from './types.ts';

export interface RouterOptions {
  logger: Logger;
  grants: GrantStore;
  handlers: Partial<Record<MethodName, Handler>>;
  ratePerSecond?: number;
  now?: () => number;
}

/**
 * The only door between subapps and everything else (spec §Architecture). For every request:
 * envelope → token → rate limit → method → params schema → scopes → handler. Every rejection is
 * logged with app id, method, code and timestamp, and recorded for Diagnostics.
 */
export class BridgeRouter {
  readonly rejections = new RingLog<Rejection>(500);
  readonly inspector = new RingLog<InspectorEntry>(1000);
  private sessions = new Map<string, Session>();
  private validators = compileParamValidators();
  private limiter: RateLimiter;
  private now: () => number;

  constructor(private readonly opts: RouterOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.limiter = new RateLimiter(opts.ratePerSecond ?? DEFAULT_RATE_LIMIT_PER_SECOND, this.now);
  }

  attach(session: Session): void {
    this.detach(session.appId, 'replaced');
    this.sessions.set(session.appId, session);
    session.port.onmessage = (e) => {
      void this.handle(session, e.data);
    };
  }

  /** Ends a session: closes the port and forgets the token (iframe destroyed or scope revoked). */
  detach(appId: string, reason: string): boolean {
    const s = this.sessions.get(appId);
    if (!s) return false;
    s.port.onmessage = null;
    s.port.close();
    this.sessions.delete(appId);
    this.limiter.forget(appId);
    this.opts.logger.info('bridge.session_ended', { appId, reason });
    return true;
  }

  hasSession(appId: string): boolean {
    return this.sessions.has(appId);
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  /** Push an event to one app (used by the bus from M5; also by the shell for theme changes). */
  emit(appId: string, topic: string, payload: unknown): boolean {
    const s = this.sessions.get(appId);
    if (!s) return false;
    const evt: EventEnvelope = { v: ENVELOPE_VERSION, kind: 'evt', topic, payload, ts: new Date(this.now()).toISOString() };
    s.port.postMessage(evt);
    this.trace({ appId, direction: 'out', kind: 'evt', method: topic });
    return true;
  }

  /** Record a rejection that happened outside a session (e.g. a forged handshake). */
  reject(appId: string, method: string, code: ErrorCode, message: string): Rejection {
    const r: Rejection = { ts: new Date(this.now()).toISOString(), appId, method, code, message };
    this.rejections.push(r);
    this.opts.logger.warn('bridge.rejected', { appId, method, code, reason: message });
    return r;
  }

  async handle(session: Session, data: unknown): Promise<void> {
    const started = this.now();
    const parsed = parseRequest(data);
    if (!parsed.ok) {
      this.reject(session.appId, '?', 'BAD_ENVELOPE', parsed.reason);
      if (parsed.id) this.respond(session, parsed.id, '?', started, { code: 'BAD_ENVELOPE', message: parsed.reason });
      return;
    }
    const { req } = parsed;
    this.trace({ appId: session.appId, direction: 'in', kind: 'req', method: req.method });

    // A session that was detached (revoked) must not answer, even if a message was already queued.
    if (this.sessions.get(session.appId) !== session) return;

    const fail = (code: ErrorCode, message: string) => {
      this.reject(session.appId, req.method, code, message);
      this.respond(session, req.id, req.method, started, { code, message });
    };

    if (!safeEqual(req.token, session.token)) return fail('BAD_TOKEN', 'Session token does not match.');
    if (!this.limiter.take(session.appId)) return fail('RATE_LIMITED', 'Too many requests.');
    if (!isMethodName(req.method)) return fail('UNKNOWN_METHOD', `Unknown method ${req.method}.`);

    const method = req.method;
    const validate = this.validators[method];
    if (!validate(req.params)) return fail('INVALID_PARAMS', describeAjvError(validate));

    const spec = METHODS[method];
    const scopes = spec.scopes(req.params, session.appId);
    if (scopes === null) return fail('SCOPE_DENIED', `${method} is not allowed for these params.`);
    for (const scope of scopes) {
      const check = checkScope(session.manifest, scope, this.opts.grants);
      if (!check.ok) return fail('SCOPE_DENIED', `Scope ${scope}: ${check.reason}.`);
    }
    if (scopes.includes('data.own')) {
      const collection = String(req.params.collection);
      if (!session.manifest.collections.includes(collection)) return fail('SCOPE_DENIED', `Collection ${collection} is not declared in the manifest.`);
    }

    const handler = this.opts.handlers[method];
    if (!handler) return fail('NOT_IMPLEMENTED', `${method} arrives in ${spec.since}.`);

    try {
      const result = await handler({ appId: session.appId, manifest: session.manifest }, req.params);
      if (this.sessions.get(session.appId) !== session) return; // revoked while running
      this.respond(session, req.id, method, started, null, result ?? {});
    } catch (err) {
      if (err instanceof ShellError) return fail(err.code, err.message);
      this.opts.logger.error('bridge.handler_failed', { appId: session.appId, method, error: (err as Error).message });
      fail('INTERNAL', 'The shell could not complete this call.');
    }
  }

  private respond(
    session: Session,
    id: string,
    method: string,
    started: number,
    error: { code: ErrorCode; message: string } | null,
    result?: unknown,
  ): void {
    const res: ResponseEnvelope = error
      ? { v: ENVELOPE_VERSION, id, kind: 'res', ok: false, error: bridgeError(error.code, error.message) }
      : { v: ENVELOPE_VERSION, id, kind: 'res', ok: true, result };
    session.port.postMessage(res);
    this.trace({ appId: session.appId, direction: 'out', kind: 'res', method, ok: !error, ...(error ? { code: error.code } : {}), ms: this.now() - started });
  }

  trace(e: Omit<InspectorEntry, 'ts'>): void {
    this.inspector.push({ ts: new Date(this.now()).toISOString(), ...e });
  }
}
