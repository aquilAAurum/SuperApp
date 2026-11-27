import type { BridgeErrorBody } from './errors.ts';
import { ENVELOPE_VERSION } from './version.ts';
import { isAppId } from './ids.ts';

export type FormFactor = 'phone' | 'tablet' | 'tv' | 'car' | 'desktop';
export const FORM_FACTORS: readonly FormFactor[] = ['phone', 'tablet', 'tv', 'car', 'desktop'];

/** Subapp → shell, on window.parent, before the private port exists. */
export interface HelloMessage {
  type: 'hello';
  appId: string;
  sdkVersion: string;
}

/** Shell → subapp, transferring the private MessagePort. */
export interface WelcomeMessage {
  type: 'welcome';
  sessionToken: string;
  apiVersion: string;
  grantedScopes: string[];
  user: { id: string; name: string } | null;
  device: { id: string | null; kind: FormFactor; name: string };
  formFactor: FormFactor;
  theme: 'light' | 'dark';
  locale: string;
}

export interface RequestEnvelope {
  v: typeof ENVELOPE_VERSION;
  id: string;
  kind: 'req';
  method: string;
  params: Record<string, unknown>;
  token: string;
}

export type ResponseEnvelope =
  | { v: typeof ENVELOPE_VERSION; id: string; kind: 'res'; ok: true; result: unknown }
  | { v: typeof ENVELOPE_VERSION; id: string; kind: 'res'; ok: false; error: BridgeErrorBody };

export interface EventEnvelope {
  v: typeof ENVELOPE_VERSION;
  kind: 'evt';
  topic: string;
  payload: unknown;
  ts: string;
}

export type ShellToApp = ResponseEnvelope | EventEnvelope;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const MSG_ID = /^[A-Za-z0-9-]{8,64}$/;
const METHOD = /^[a-z]+\.[a-zA-Z.]+$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function isHelloMessage(data: unknown): data is HelloMessage {
  return (
    isRecord(data) &&
    data.type === 'hello' &&
    isAppId(data.appId) &&
    typeof data.sdkVersion === 'string' &&
    SEMVER.test(data.sdkVersion)
  );
}

/** Structural validation of a request envelope. Params are validated per method afterwards. */
export function parseRequest(data: unknown): { ok: true; req: RequestEnvelope } | { ok: false; id: string | null; reason: string } {
  if (!isRecord(data)) return { ok: false, id: null, reason: 'envelope is not an object' };
  const id = typeof data.id === 'string' && MSG_ID.test(data.id) ? data.id : null;
  if (data.v !== ENVELOPE_VERSION) return { ok: false, id, reason: 'unsupported envelope version' };
  if (data.kind !== 'req') return { ok: false, id, reason: 'kind must be "req"' };
  if (id === null) return { ok: false, id, reason: 'id must be 8-64 chars [A-Za-z0-9-]' };
  if (typeof data.method !== 'string' || !METHOD.test(data.method)) return { ok: false, id, reason: 'invalid method' };
  if (data.params !== undefined && !isRecord(data.params)) return { ok: false, id, reason: 'params must be an object' };
  if (typeof data.token !== 'string' || data.token.length === 0) return { ok: false, id, reason: 'token required' };
  return {
    ok: true,
    req: { v: ENVELOPE_VERSION, id, kind: 'req', method: data.method, params: (data.params as Record<string, unknown>) ?? {}, token: data.token },
  };
}

export function isShellToApp(data: unknown): data is ShellToApp {
  if (!isRecord(data) || data.v !== ENVELOPE_VERSION) return false;
  if (data.kind === 'res') return typeof data.id === 'string' && typeof data.ok === 'boolean';
  if (data.kind === 'evt') return typeof data.topic === 'string' && typeof data.ts === 'string';
  return false;
}
