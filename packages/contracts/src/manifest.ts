import semver from 'semver';
import { isAppId } from './ids.ts';
import { isKnownScope, isReservedScope } from './scopes.ts';
import { parseTopic } from './topics.ts';
import { FORM_FACTORS, type FormFactor } from './envelope.ts';

/** `app.json` (spec §Subapp model). */
export interface Manifest {
  id: string;
  name: string;
  version: string;
  sdk: string;
  entry: string;
  icon?: string;
  formFactors: FormFactor[];
  scopes: { required: string[]; optional: string[] };
  collections: string[];
  events: { emits: string[]; listens: string[] };
  deepLinks: string[];
  intents: { action: string; types: string[] }[];
  car: null;
  background: { tasks: [] };
}

export type ManifestResult = { ok: true; manifest: Manifest } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const SAFE_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
const DEEP_LINK = /^\/[A-Za-z0-9/:_-]*$/;
const INTENT_ACTIONS = new Set(['share.receive']);

/** Validates a manifest against the v1 rules. Returns every problem, not just the first. */
export function validateManifest(input: unknown): ManifestResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['manifest must be a JSON object'] };
  const m = input;

  if (!isAppId(m.id)) errors.push('id must be lowercase a-z0-9, 2-32 chars, start with a letter, and not reserved');
  const id = typeof m.id === 'string' ? m.id : '';
  if (typeof m.name !== 'string' || m.name.trim() === '' || m.name.length > 40) errors.push('name must be 1-40 chars');
  if (typeof m.version !== 'string' || semver.valid(m.version) === null) errors.push('version must be semver');
  if (typeof m.sdk !== 'string' || semver.validRange(m.sdk) === null) errors.push('sdk must be a semver range');
  if (typeof m.entry !== 'string' || !SAFE_PATH.test(m.entry) || !m.entry.endsWith('.html')) errors.push('entry must be a relative .html path');
  if (m.icon !== undefined && (typeof m.icon !== 'string' || !SAFE_PATH.test(m.icon))) errors.push('icon must be a relative path');

  if (!isStringArray(m.formFactors) || m.formFactors.length === 0 || !m.formFactors.every((f) => (FORM_FACTORS as readonly string[]).includes(f))) {
    errors.push(`formFactors must be a non-empty subset of ${FORM_FACTORS.join(', ')}`);
  }

  if (!isRecord(m.scopes) || !isStringArray(m.scopes.required) || !isStringArray(m.scopes.optional)) {
    errors.push('scopes.required and scopes.optional must be string arrays');
  } else {
    for (const s of [...m.scopes.required, ...m.scopes.optional]) {
      if (isReservedScope(s)) errors.push(`scope "${s}" is reserved for a later version`);
      else if (!isKnownScope(s)) errors.push(`unknown scope "${s}"`);
    }
  }

  if (!isStringArray(m.collections)) errors.push('collections must be a string array');
  else for (const c of m.collections) if (!c.startsWith(`${id}_`)) errors.push(`collection "${c}" must be prefixed "${id}_"`);

  if (!isRecord(m.events) || !isStringArray(m.events.emits) || !isStringArray(m.events.listens)) {
    errors.push('events.emits and events.listens must be string arrays');
  } else {
    for (const t of m.events.emits) {
      const p = parseTopic(t);
      if (!p || p.owner !== id) errors.push(`emitted topic "${t}" must be "${id}.<entity>.<verb>"`);
    }
    for (const t of m.events.listens) if (!parseTopic(t)) errors.push(`listened topic "${t}" is not a valid topic`);
  }

  if (!isStringArray(m.deepLinks) || !m.deepLinks.every((d) => DEEP_LINK.test(d))) errors.push('deepLinks must be paths like "/expense/:id"');

  if (!Array.isArray(m.intents) || !m.intents.every((i) => isRecord(i) && typeof i.action === 'string' && INTENT_ACTIONS.has(i.action) && isStringArray(i.types))) {
    errors.push('intents must be [{ action: "share.receive", types: string[] }]');
  }

  // Reserved for later (spec): must be null / empty in v1.
  if (m.car !== null) errors.push('car is reserved and must be null in v1');
  if (!isRecord(m.background) || !Array.isArray(m.background.tasks) || m.background.tasks.length !== 0) {
    errors.push('background is reserved and must be { "tasks": [] } in v1');
  }

  return errors.length ? { ok: false, errors } : { ok: true, manifest: m as unknown as Manifest };
}

/** True if this shell's SDK/API version satisfies the manifest's `sdk` range. */
export function sdkSatisfies(sdkVersion: string, range: string): boolean {
  return semver.valid(sdkVersion) !== null && semver.satisfies(sdkVersion, range, { includePrerelease: false });
}

/** All scopes a manifest may ever hold: required + optional + bus scopes derived from events. */
export function declaredScopes(manifest: Manifest): Set<string> {
  const scopes = new Set([...manifest.scopes.required, ...manifest.scopes.optional]);
  for (const t of manifest.events.emits) scopes.add(`bus.emit:${t}`);
  for (const t of manifest.events.listens) scopes.add(`bus.listen:${t}`);
  return scopes;
}
