import { CONSENT_SCOPES, declaredScopes, type Manifest } from '@superapp/contracts';

export type Decision = 'allow' | 'allow_once' | 'deny';

/** Source of the user's per-app scope decisions (SQLite + server `grants` mirror from M4). */
export interface GrantStore {
  get(appId: string, scope: string): Decision | undefined;
}

export class MemoryGrantStore implements GrantStore {
  private map = new Map<string, Decision>();
  set(appId: string, scope: string, d: Decision): void {
    this.map.set(`${appId}\u0000${scope}`, d);
  }
  get(appId: string, scope: string): Decision | undefined {
    return this.map.get(`${appId}\u0000${scope}`);
  }
}

export type ScopeCheck = { ok: true } | { ok: false; reason: 'not_declared' | 'denied' | 'consent_required' };

/**
 * A subapp holds scope X only if its manifest declares X and, for consent-gated scopes, the user
 * allowed it (spec §Permissions grant flow, steps 2-3). Android runtime permissions are checked by
 * the CapabilityBroker at call time (step 4).
 */
export function checkScope(manifest: Manifest, scope: string, grants: GrantStore): ScopeCheck {
  if (!declaredScopes(manifest).has(scope)) return { ok: false, reason: 'not_declared' };
  if (!CONSENT_SCOPES.has(scope)) return { ok: true };
  const d = grants.get(manifest.id, scope);
  if (d === 'allow' || d === 'allow_once') return { ok: true };
  if (d === 'deny') return { ok: false, reason: 'denied' };
  return { ok: false, reason: 'consent_required' };
}

/** Scopes granted right now (sent in the welcome). */
export function grantedScopes(manifest: Manifest, grants: GrantStore): string[] {
  return [...declaredScopes(manifest)].filter((s) => checkScope(manifest, s, grants).ok).sort();
}
