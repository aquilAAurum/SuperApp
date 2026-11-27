/** App ids: lowercase, start with a letter, 2-32 chars of a-z, 0-9 (spec §Subapp model). */
export const APP_ID_PATTERN = /^[a-z][a-z0-9]{1,31}$/;
/** PocketBase record ids: 15 chars, a-z0-9 (spec §Data layer). */
export const RECORD_ID_PATTERN = /^[a-z0-9]{15}$/;
/** Ids reserved for the shell and core namespaces. */
export const RESERVED_APP_IDS: ReadonlySet<string> = new Set(['core', 'shell', 'sys', 'app', 'superapp']);

export function isAppId(value: unknown): value is string {
  return typeof value === 'string' && APP_ID_PATTERN.test(value) && !RESERVED_APP_IDS.has(value);
}
