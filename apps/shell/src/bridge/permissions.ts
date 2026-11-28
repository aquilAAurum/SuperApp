import { CONSENT_SCOPES, declaredScopes, type Manifest } from '@superapp/contracts';

export type Decision = 'allow' | 'allow_once' | 'deny';

/** Source of the user's per-app scope decisions (SQLite + server `grants` mirror from M4). */
export interface GrantStore {
  get(appId: string, scope: string): Decision | undefined;
}

export interface GrantEntry {
  appId: string;
  scope: string;
  decision: Decision;
}

/**
 * Per-app scope decisions. "Allow" and "Deny" are remembered (the shell persists `toJSON()` and
 * restores it with `load()`); "Allow once" lasts until the app's session ends (`endSession`).
 * Mirroring to the server `grants` collection arrives with the rest of M4.
 */
export class MemoryGrantStore implements GrantStore {
  private map = new Map<string, Decision>();
  private listeners = new Set<() => void>();
  private key = (appId: string, scope: string) => `${appId}\u0000${scope}`;

  set(appId: string, scope: string, d: Decision): void {
    this.map.set(this.key(appId, scope), d);
    this.changed();
  }
  get(appId: string, scope: string): Decision | undefined {
    return this.map.get(this.key(appId, scope));
  }
  /** Forget a decision so the consent sheet asks again (Settings → Permissions → Reset). */
  delete(appId: string, scope: string): void {
    if (this.map.delete(this.key(appId, scope))) this.changed();
  }
  entries(): GrantEntry[] {
    return [...this.map].map(([k, decision]) => {
      const [appId = '', scope = ''] = k.split('\u0000');
      return { appId, scope, decision };
    });
  }
  /** Drops "Allow once" decisions for an app whose session ended. */
  endSession(appId: string): void {
    let changed = false;
    for (const e of this.entries()) if (e.appId === appId && e.decision === 'allow_once') changed = this.map.delete(this.key(e.appId, e.scope)) || changed;
    if (changed) this.changed();
  }
  /** Remembered decisions only; "Allow once" is never persisted. */
  toJSON(): GrantEntry[] {
    return this.entries().filter((e) => e.decision !== 'allow_once');
  }
  load(entries: unknown): void {
    if (!Array.isArray(entries)) return;
    for (const e of entries as Partial<GrantEntry>[]) {
      if (typeof e?.appId === 'string' && typeof e.scope === 'string' && (e.decision === 'allow' || e.decision === 'deny')) this.map.set(this.key(e.appId, e.scope), e.decision);
    }
    this.changed();
  }
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed(): void {
    for (const l of this.listeners) l();
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
