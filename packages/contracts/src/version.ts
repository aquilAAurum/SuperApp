/** Bridge API version implemented by this contract. Minor = additive, major = breaking (spec §Bridge API). */
export const API_VERSION = '1.1' as const;
export const API_MAJOR = 1 as const;
/** Protocol envelope version carried in every message as `v`. */
export const ENVELOPE_VERSION = 1 as const;
/** Defaults from the product spec. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const HANDSHAKE_TIMEOUT_MS = 10_000;
export const DEFAULT_RATE_LIMIT_PER_SECOND = 50;
export const MAX_BUS_PAYLOAD_BYTES = 64 * 1024;
export const MAX_SUSPENDED_APPS = 3;
