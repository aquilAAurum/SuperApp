export const ERROR_CODES = [
  'INVALID_PARAMS',
  'SCOPE_DENIED',
  'NOT_FOUND',
  'CONFLICT',
  'OFFLINE_QUEUED',
  'UNAVAILABLE',
  'TIMEOUT',
  'RATE_LIMITED',
  'SERVER_ERROR',
  'INTERNAL',
  // Bridge-level rejections (not in the spec's method error list, but logged with the same shape).
  'BAD_ENVELOPE',
  'BAD_TOKEN',
  'UNKNOWN_METHOD',
  'NOT_IMPLEMENTED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface BridgeErrorBody {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['TIMEOUT', 'RATE_LIMITED', 'SERVER_ERROR']);

export function bridgeError(code: ErrorCode, message: string): BridgeErrorBody {
  return { code, message, retryable: RETRYABLE.has(code) };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
