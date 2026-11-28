/**
 * Subapp updates by pull (ADR-009, spec §Packaging and install, §Hot updates).
 *
 *   Claude/dev  ──commit──► published/<id>/  (git, merged to main by Nick)
 *   mini PC     ──pull────► subapps_inbox/ ──hook──► PocketBase `subapps` collection
 *   phone       ──pull────► this module: list → download → verify → store → serve from the mirror DB
 *
 * The phone trusts nothing in the record except which zip to fetch: the zip's SHA-256 must equal
 * the record's, and the app.json *inside* the zip (covered by the hash) must be a valid manifest
 * with the record's id and version. Bundles are stored in the shell's encrypted local database
 * (meta table) so an installed update works offline. The previous version is kept; a version that
 * crashes twice within 60 s of its first run is rolled back and never offered again.
 */
import { unzipSync } from 'fflate';

import type { KvBackend, KvWrite } from '../sync/kv.ts';
import type { Logger } from '../core/logger.ts';
import { compareVersions, isVersion, validateManifest, type Manifest } from '@superapp/contracts';

export interface SubappRecord {
  id: string;
  appId: string;
  version: string;
  sha256: string;
  bundle: string;
}

export interface UpdateSource {
  listSubapps(): Promise<SubappRecord[]>;
  downloadSubapp(rec: SubappRecord): Promise<Uint8Array>;
}

export interface StoredBundle {
  manifest: Manifest;
  html: string;
  sha256: string;
  installedAt: string;
}

interface AppState {
  current: string | null;
  previous: string | null;
  bad: string[];
  firstRunAt: number | null;
  crashes: number[];
}
type State = Record<string, AppState>;

export interface InstalledBundle {
  manifest: Manifest;
  loadHtml: () => Promise<string>;
}

export type CheckResult = { appId: string; version: string; outcome: 'installed' | 'rejected'; reason?: string };

export const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;
export const CRASH_WINDOW_MS = 60_000;
const STATE_KEY = 'subapps:state';
const bundleKey = (appId: string, version: string) => `subapps:bundle:${appId}@${version}`;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Verifies and unpacks one downloaded bundle. Throws with a reason the owner can read in Diagnostics. */
export async function verifyBundle(rec: SubappRecord, zip: Uint8Array): Promise<{ manifest: Manifest; html: string; sha256: string }> {
  if (zip.byteLength > MAX_BUNDLE_BYTES) throw new Error(`bundle is ${zip.byteLength} bytes (max ${MAX_BUNDLE_BYTES})`);
  const hash = await sha256Hex(zip);
  if (hash !== rec.sha256) throw new Error('SHA-256 does not match the server record');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch (err) {
    throw new Error(`not a valid zip (${(err as Error).message})`, { cause: err });
  }
  const raw = files['app.json'];
  if (!raw) throw new Error('app.json missing at the bundle root');
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error('app.json is not valid JSON');
  }
  const v = validateManifest(json);
  if (!v.ok) throw new Error(`invalid manifest: ${v.errors.slice(0, 3).join('; ')}`);
  if (v.manifest.id !== rec.appId || v.manifest.version !== rec.version) throw new Error(`bundle is ${v.manifest.id}@${v.manifest.version}, record says ${rec.appId}@${rec.version}`);
  const entry = files[v.manifest.entry];
  if (!entry) throw new Error(`entry ${v.manifest.entry} missing`);
  return { manifest: v.manifest, html: new TextDecoder('utf-8', { fatal: true }).decode(entry), sha256: hash };
}

export interface UpdaterDeps {
  kv: KvBackend;
  source: UpdateSource;
  logger: Logger;
  /** Version shipped inside the APK, if any (builtin bundles are the fallback). */
  builtinVersion: (appId: string) => string | null;
  now?: () => number;
}

export class SubappUpdater {
  private state: State = {};
  private loaded = false;
  private checking: Promise<CheckResult[]> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: UpdaterDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  private app(appId: string): AppState {
    return (this.state[appId] ??= { current: null, previous: null, bad: [], firstRunAt: null, crashes: [] });
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.state = (await this.deps.kv.get<State>('meta', STATE_KEY)) ?? {};
    this.loaded = true;
  }

  private stateWrite(): KvWrite {
    return { table: 'meta', key: STATE_KEY, value: this.state };
  }

  private bundleRef(appId: string, version: string, manifest: Manifest): InstalledBundle {
    return {
      manifest,
      loadHtml: async () => {
        const b = await this.deps.kv.get<StoredBundle>('meta', bundleKey(appId, version));
        if (!b) throw new Error(`stored bundle ${appId}@${version} is missing`);
        return b.html;
      },
    };
  }

  /** Server-installed bundles that should run instead of the builtin copy (newer than it). */
  async installed(): Promise<InstalledBundle[]> {
    await this.load();
    const out: InstalledBundle[] = [];
    for (const [appId, s] of Object.entries(this.state)) {
      if (!s.current) continue;
      const b = await this.deps.kv.get<StoredBundle>('meta', bundleKey(appId, s.current));
      if (!b) continue;
      const builtin = this.deps.builtinVersion(appId);
      if (builtin && compareVersions(builtin, s.current) >= 0) continue;
      out.push(this.bundleRef(appId, s.current, b.manifest));
    }
    return out;
  }

  /** What runs for each app, for Settings. */
  async summary(): Promise<{ appId: string; server: string | null; previous: string | null; bad: string[] }[]> {
    await this.load();
    return Object.entries(this.state).map(([appId, s]) => ({ appId, server: s.current, previous: s.previous, bad: [...s.bad] }));
  }

  /** Pull: install every app whose newest good server version beats what is on the phone. One at a time. */
  check(): Promise<CheckResult[]> {
    this.checking ??= this.runCheck().finally(() => (this.checking = null));
    return this.checking;
  }

  private async runCheck(): Promise<CheckResult[]> {
    await this.load();
    const records = await this.deps.source.listSubapps();
    const newest = new Map<string, SubappRecord>();
    for (const r of records) {
      if (!isVersion(r.version) || !/^[0-9a-f]{64}$/.test(r.sha256)) continue;
      if (this.state[r.appId]?.bad.includes(r.version)) continue;
      const cur = newest.get(r.appId);
      if (!cur || compareVersions(r.version, cur.version) > 0) newest.set(r.appId, r);
    }
    const results: CheckResult[] = [];
    for (const rec of newest.values()) {
      const s = this.state[rec.appId];
      const have = [s?.current, this.deps.builtinVersion(rec.appId)].filter((v): v is string => !!v).sort(compareVersions).at(-1);
      if (have && compareVersions(rec.version, have) <= 0) continue;
      try {
        const zip = await this.deps.source.downloadSubapp(rec);
        const b = await verifyBundle(rec, zip);
        const a = this.app(rec.appId);
        const writes: KvWrite[] = [];
        // Keep the current version as the rollback target; drop the one before it.
        if (a.previous && a.previous !== a.current) writes.push({ table: 'meta', key: bundleKey(rec.appId, a.previous), value: null });
        a.previous = a.current;
        a.current = rec.version;
        a.firstRunAt = null;
        a.crashes = [];
        const stored: StoredBundle = { manifest: b.manifest, html: b.html, sha256: b.sha256, installedAt: new Date(this.now()).toISOString() };
        writes.push({ table: 'meta', key: bundleKey(rec.appId, rec.version), value: stored }, this.stateWrite());
        await this.deps.kv.commit(writes);
        this.deps.logger.info('bundles.update_installed', { appId: rec.appId, version: rec.version, previous: a.previous, sha256: b.sha256 });
        results.push({ appId: rec.appId, version: rec.version, outcome: 'installed' });
      } catch (err) {
        const reason = (err as Error).message;
        this.deps.logger.error('bundles.update_rejected', { appId: rec.appId, version: rec.version, reason });
        results.push({ appId: rec.appId, version: rec.version, outcome: 'rejected', reason });
      }
    }
    return results;
  }

  /** A server-installed version handshook. Starts its 60 s crash window on first run. */
  async onStarted(appId: string): Promise<void> {
    await this.load();
    const a = this.state[appId];
    if (!a?.current || a.firstRunAt !== null) return;
    a.firstRunAt = this.now();
    await this.deps.kv.commit([this.stateWrite()]);
  }

  /**
   * A crash of the current server version. Two within 60 s of its first run → roll back. Returns
   * the version now in charge (`previous`, or null meaning the builtin copy) when it rolled back.
   */
  async onCrashed(appId: string): Promise<{ rolledBack: true; from: string; to: string | null } | { rolledBack: false }> {
    await this.load();
    const a = this.state[appId];
    if (!a?.current) return { rolledBack: false };
    const t = this.now();
    a.firstRunAt ??= t;
    if (t - a.firstRunAt > CRASH_WINDOW_MS) {
      await this.deps.kv.commit([this.stateWrite()]);
      return { rolledBack: false };
    }
    a.crashes.push(t);
    if (a.crashes.length < 2) {
      await this.deps.kv.commit([this.stateWrite()]);
      return { rolledBack: false };
    }
    return this.rollback(appId, 'crashed twice within 60 s of the update');
  }

  async rollback(appId: string, reason: string): Promise<{ rolledBack: true; from: string; to: string | null } | { rolledBack: false }> {
    await this.load();
    const a = this.state[appId];
    if (!a?.current) return { rolledBack: false };
    const from = a.current;
    if (!a.bad.includes(from)) a.bad.push(from);
    a.current = a.previous;
    a.previous = null;
    a.firstRunAt = null;
    a.crashes = [];
    await this.deps.kv.commit([{ table: 'meta', key: bundleKey(appId, from), value: null }, this.stateWrite()]);
    this.deps.logger.error('bundles.rolled_back', { appId, from, to: a.current ?? 'builtin', reason });
    return { rolledBack: true, from, to: a.current };
  }

  /** The bundle to run for an app after a rollback (null → use the builtin copy). */
  async current(appId: string): Promise<InstalledBundle | null> {
    await this.load();
    const v = this.state[appId]?.current;
    if (!v) return null;
    const b = await this.deps.kv.get<StoredBundle>('meta', bundleKey(appId, v));
    return b ? this.bundleRef(appId, v, b.manifest) : null;
  }
}
