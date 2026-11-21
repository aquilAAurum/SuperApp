import type { BridgeErrorBody, ErrorCode, Manifest } from '@superapp/contracts';

/** The subset of MessagePort the router uses (injectable for tests). */
export interface PortLike {
  postMessage(msg: unknown): void;
  close(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}

export interface Session {
  appId: string;
  token: string;
  manifest: Manifest;
  port: PortLike;
  startedAt: number;
}

export interface CallContext {
  appId: string;
  manifest: Manifest;
}

export type Handler = (ctx: CallContext, params: Record<string, unknown>) => unknown | Promise<unknown>;

/** Thrown by handlers to answer with a specific bridge error code. */
export class ShellError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ShellError';
  }
}

/** Every rejected call or handshake is recorded with app id, method, code and timestamp (spec note 6). */
export interface Rejection {
  ts: string;
  appId: string;
  method: string;
  code: ErrorCode;
  message: string;
}

export interface InspectorEntry {
  ts: string;
  appId: string;
  direction: 'in' | 'out';
  kind: 'hello' | 'welcome' | 'req' | 'res' | 'evt';
  method?: string;
  ok?: boolean;
  code?: ErrorCode;
  ms?: number;
}

export type ErrorOf = BridgeErrorBody;
