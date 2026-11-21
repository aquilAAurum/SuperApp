import { isAppId } from './ids.ts';

/** `<appId>.<entity>.<verb>`; core topics start with `core.` (spec §Message bus). */
export const TOPIC_PATTERN = /^([a-z][a-z0-9]{1,31})\.([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;

export function parseTopic(topic: unknown): { owner: string; entity: string; verb: string } | null {
  if (typeof topic !== 'string') return null;
  const m = TOPIC_PATTERN.exec(topic);
  if (!m) return null;
  const [, owner, entity, verb] = m as unknown as [string, string, string, string];
  if (owner !== 'core' && !isAppId(owner)) return null;
  return { owner, entity, verb };
}

/** A subapp may only emit topics prefixed with its own id. */
export function canEmit(appId: string, topic: string): boolean {
  const parsed = parseTopic(topic);
  return parsed !== null && parsed.owner === appId;
}
