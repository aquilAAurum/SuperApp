/**
 * Composition root. Wires logger → router → handshake → lifecycle and exposes Svelte-compatible
 * stores to the UI. No domain features live here (spec: the shell is a platform).
 */
import { API_VERSION, type Capabilities, type Manifest, METHODS, type MethodName } from '@superapp/contracts';
import { log, type LogEntry } from './core/logger.ts';
import { RingLog } from './core/observable.ts';
import { BridgeRouter } from './bridge/router.ts';
import { HandshakeGuard } from './bridge/handshake.ts';
import { MemoryGrantStore, grantedScopes, type Decision } from './bridge/permissions.ts';
import { coreHandlers } from './bridge/handlers.ts';
import { deviceHandlers } from './bridge/device-handlers.ts';
import { SubappLifecycle, type AppStatus } from './host/lifecycle.ts';
import { domFrameFactory } from './host/frames.ts';
import { loadBuiltinBundles, type BundleRef } from './host/bundles.ts';
import { SubappUpdater, type CheckResult, type InstalledBundle } from './host/updates.ts';
import { CapabilityBroker } from './native/CapabilityBroker.ts';
import { ServerClient, type Reachability, type SignedInUser } from './server/ServerClient.ts';
import { writable, type Writable } from './ui/store.ts';
import type { Handler, PortLike } from './bridge/types.ts';
import { SyncEngine } from './sync/engine.ts';
import { dataHandlers } from './sync/handlers.ts';
import { DeferredKv, type KvBackend } from './sync/kv.ts';
import { IndexedDbKv } from './sync/idb-kv.ts';
import { SqliteKv } from './sync/sqlite-kv.ts';
import { showToast } from './ui/store.ts';

export const SHELL_VERSION = __SHELL_VERSION__;

export type SyncStatus = { label: 'Synced' | 'Offline' | 'Error'; detail: string };

/** A consent sheet waiting for the owner (spec §Permissions grant flow, step 3). */
export interface ConsentRequest {
  appId: string;
  appName: string;
  scope: string;
}

const GRANTS_PREF = 'grants.v1';

export interface ShellState {
  user: SignedInUser | null;
  deviceId: string | null;
  serverUrl: string | null;
  reachability: Reachability;
  safeMode: boolean;
  theme: 'light' | 'dark' | 'system';
}

export class Shell {
  readonly broker = new CapabilityBroker();
  readonly server = new ServerClient(this.broker, log);
  readonly grants = new MemoryGrantStore();
  readonly logs = new RingLog<LogEntry>(500);
  readonly bundles = new Map<string, BundleRef>();
  /** Copies shipped in the APK; the fallback when a server-installed version is rolled back. */
  private readonly builtins = new Map<string, BundleRef>();
  /** Updates waiting for their app to stop running (spec §Hot updates: applies on next start). */
  private readonly pendingBundles = new Map<string, BundleRef>();
  readonly updater: SubappUpdater;
  private lastUpdateCheck = 0;
  static readonly UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
  readonly titles: Writable<Record<string, string>> = writable({});
  readonly state: Writable<ShellState> = writable<ShellState>({
    user: null,
    deviceId: null,
    serverUrl: null,
    reachability: { state: 'offline' },
    safeMode: false,
    theme: 'system',
  });
  /** The consent sheet on screen (one at a time; further requests queue behind it). */
  readonly consent: Writable<ConsentRequest | null> = writable<ConsentRequest | null>(null);
  private consentQueue: { req: ConsentRequest; resolve: () => void }[] = [];
  private consentPending = new Map<string, Promise<void>>();
  /** Set by the UI: called when an app asks to close or crashes while visible. */
  onAppClosed: (appId: string) => void = () => undefined;

  private readonly handlers: Partial<Record<MethodName, Handler>>;
  readonly sync: SyncEngine;
  private realtime = new Map<string, () => Promise<void>>();
  readonly router: BridgeRouter;
  readonly handshake: HandshakeGuard;
  readonly lifecycle: SubappLifecycle;
  private hostEl: HTMLElement | null = null;
  private cleanups: (() => void)[] = [];

  constructor() {
    this.cleanups.push(log.addSink((e) => this.logs.push(e)));
    const implemented = (): string[] => Object.keys(METHODS).filter((m) => m in this.handlers);
    this.handlers = coreHandlers({
      logger: log,
      capabilities: (): Capabilities => ({
        apiVersion: API_VERSION,
        shellVersion: SHELL_VERSION,
        formFactor: this.broker.formFactor(),
        platform: this.broker.platform,
        methods: implemented(),
        device: this.broker.deviceCapabilities(),
      }),
      setTitle: (appId, title) => this.titles.update((t) => ({ ...t, [appId]: title })),
      close: (appId) => {
        this.lifecycle.close(appId, 'app.close');
        this.onAppClosed(appId);
      },
      markReady: (appId) => log.info('subapp.ready', { appId }),
      route: () => '/',
    });
    const kv: Promise<KvBackend> = this.broker.openDatabase().then((db) => (db ? new SqliteKv(db) : new IndexedDbKv()));
    const db = new DeferredKv(kv);
    this.updater = new SubappUpdater({
      kv: db,
      source: this.server,
      logger: log,
      builtinVersion: (appId) => this.builtins.get(appId)?.manifest.version ?? null,
    });
    this.sync = new SyncEngine({
      kv: db,
      server: this.server,
      logger: log,
      emit: (appId, topic, payload) => void this.router.emit(appId, topic, payload),
      deviceId: () => this.state.get().deviceId,
      onAuthError: () => void this.recoverAuth(),
    });
    Object.assign(this.handlers, dataHandlers(this.sync), deviceHandlers(this.broker.devicePort(), log));
    this.router = new BridgeRouter({
      logger: log,
      grants: this.grants,
      handlers: this.handlers,
      onDetach: (appId) => {
        this.sync.dropApp(appId);
        this.grants.endSession(appId);
        this.dismissConsent(appId);
      },
      requestConsent: (appId, manifest, scope) => this.askConsent(appId, manifest, scope),
    });
    this.cleanups.push(this.grants.onChange(() => void this.broker.setPref(GRANTS_PREF, JSON.stringify(this.grants.toJSON())).catch(() => undefined)));
    this.handshake = new HandshakeGuard({
      router: this.router,
      createChannel: () => {
        const c = new MessageChannel();
        return { port1: c.port1 as unknown as PortLike, port2: c.port2 };
      },
      welcomeFor: (manifest) => {
        const s = this.state.get();
        return {
          grantedScopes: grantedScopes(manifest, this.grants),
          user: s.user ? { id: s.user.id, name: s.user.name } : null,
          device: { id: s.deviceId, kind: this.broker.formFactor(), name: 'This phone' },
          formFactor: this.broker.formFactor(),
          theme: this.effectiveTheme(),
          locale: navigator.language,
        };
      },
    });
    this.lifecycle = new SubappLifecycle({
      createFrame: domFrameFactory(
        () => {
          if (!this.hostEl) throw new Error('Host container not mounted');
          return this.hostEl;
        },
        () => this.bundles,
      ),
      handshake: this.handshake,
      router: this.router,
      logger: log,
    });
    this.cleanups.push(this.watchUpdatedApps());
    const onMessage = (e: MessageEvent) => {
      this.handshake.onWindowMessage({ source: e.source, data: e.data, origin: e.origin });
    };
    window.addEventListener('message', onMessage);
    this.cleanups.push(() => window.removeEventListener('message', onMessage));
  }

  mountHost(el: HTMLElement): void {
    this.hostEl = el;
  }

  effectiveTheme(): 'light' | 'dark' {
    const t = this.state.get().theme;
    if (t !== 'system') return t;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  async boot(): Promise<'setup' | 'home'> {
    const [url, safe, theme, grants] = await Promise.all([this.broker.getPref('serverUrl'), this.broker.getPref('safeMode'), this.broker.getPref('theme'), this.broker.getPref(GRANTS_PREF)]);
    try {
      if (grants) this.grants.load(JSON.parse(grants));
    } catch {
      log.warn('grants.load_failed', {});
    }
    // Refreshes sys.capabilities().device.health; failures just leave it false.
    void this.broker.health.status().catch(() => undefined);
    this.state.update((s) => ({ ...s, safeMode: safe === '1', theme: theme === 'light' || theme === 'dark' ? theme : 'system' }));
    for (const b of await loadBuiltinBundles(log)) {
      this.builtins.set(b.manifest.id, b);
      this.bundles.set(b.manifest.id, b);
      this.lifecycle.register(b);
    }
    // Updates pulled earlier run from the local database, so they work offline (ADR-009).
    for (const b of await this.updater.installed().catch(() => [])) this.installBundle(serverRef(b));
    this.lifecycle.setSafeMode(safe === '1');
    if (!url) return 'setup';
    try {
      this.server.configure(url);
    } catch {
      return 'setup';
    }
    this.state.update((s) => ({ ...s, serverUrl: this.server.url }));
    const user = await this.server.restore();
    const deviceId = await this.server.deviceId();
    if (!user || !deviceId) return 'setup';
    this.state.update((s) => ({ ...s, user, deviceId }));
    void this.refreshReachability();
    void this.server.heartbeat(deviceId);
    this.startSync();
    return 'home';
  }

  /** First-run setup: server URL, sign in, register this device. */
  async setup(url: string, email: string, password: string): Promise<void> {
    this.server.configure(url);
    const user = await this.server.signIn(email, password);
    const device = await this.broker.device().catch(() => null);
    const deviceId = await this.server.registerDevice({
      name: device?.name ?? 'Phone',
      kind: this.broker.formFactor(),
      formFactor: this.broker.formFactor(),
      shellVersion: SHELL_VERSION,
      capabilities: this.broker.deviceCapabilities(),
    });
    await this.broker.setPref('serverUrl', this.server.url!);
    this.state.update((s) => ({ ...s, user, deviceId, serverUrl: this.server.url }));
    void this.refreshReachability();
    this.startSync();
  }

  private syncStarted = false;

  /** Background sync: 30 s tick, connectivity changes, resume catch-up, schema check, realtime. */
  private startSync(): void {
    if (this.syncStarted) {
      this.sync.resumeAfterAuth();
      this.sync.schedule(0);
      return;
    }
    this.syncStarted = true;
    const tick = setInterval(() => this.sync.schedule(0), 30_000);
    this.cleanups.push(() => clearInterval(tick));
    void this.broker.onNetworkChange((n) => {
      if (n.connected) void this.refreshReachability();
      else this.sync.setOnline(false);
    }).then((off) => this.cleanups.push(off));
    void this.broker.onResume(() => void this.onResume()).then((off) => this.cleanups.push(off));
    const updates = setInterval(() => void this.checkForUpdates(), Shell.UPDATE_INTERVAL_MS);
    this.cleanups.push(() => clearInterval(updates));
    void this.onResume();
  }

  async onResume(): Promise<void> {
    const r = await this.refreshReachability();
    if (r.state !== 'online') return;
    const schema = await this.server.schemaVersion();
    this.sync.pauseForSchema(schema !== null && schema > ServerClient.SUPPORTED_SCHEMA);
    await this.sync.catchUpAll();
    await this.subscribeRealtime();
    this.sync.schedule(0);
    if (Date.now() - this.lastUpdateCheck >= Shell.UPDATE_INTERVAL_MS) void this.checkForUpdates();
  }

  // --- subapp updates (ADR-009) ---

  /** Pull newer subapp bundles from the server. Safe to call any time; one check runs at a time. */
  async checkForUpdates(): Promise<CheckResult[]> {
    this.lastUpdateCheck = Date.now();
    let results: CheckResult[];
    try {
      results = await this.updater.check();
    } catch (err) {
      log.warn('bundles.check_failed', { error: (err as Error).message });
      throw err;
    }
    for (const r of results) {
      if (r.outcome !== 'installed') continue;
      const b = await this.updater.current(r.appId);
      if (b) this.installBundle(serverRef(b));
      showToast(`${this.bundles.get(r.appId)?.manifest.name ?? r.appId} updated to ${r.version}.`);
    }
    return results;
  }

  /** Swap in a bundle now if its app isn't running, otherwise when it next stops. */
  private installBundle(ref: BundleRef): void {
    const st = this.lifecycle.get(ref.manifest.id)?.state;
    if (st === 'active' || st === 'suspended' || st === 'starting') {
      this.pendingBundles.set(ref.manifest.id, ref);
      return;
    }
    this.pendingBundles.delete(ref.manifest.id);
    this.bundles.set(ref.manifest.id, ref);
    this.lifecycle.register(ref);
  }

  /** Crash and start events feed the updater's rollback rule; stopped apps pick up pending updates. */
  private watchUpdatedApps(): () => void {
    const prev = new Map<string, string>();
    return this.lifecycle.subscribe((all) => {
      for (const s of all) {
        const before = prev.get(s.appId);
        prev.set(s.appId, s.state);
        if (before === s.state) continue;
        const fromServer = this.bundles.get(s.appId)?.source === 'server';
        if (fromServer && before === 'starting' && (s.state === 'active' || s.state === 'suspended')) void this.updater.onStarted(s.appId);
        if (fromServer && s.state === 'crashed') void this.onUpdatedAppCrashed(s.appId);
        const pending = this.pendingBundles.get(s.appId);
        if (pending && (s.state === 'installed' || s.state === 'crashed')) this.installBundle(pending);
      }
    });
  }

  private async onUpdatedAppCrashed(appId: string): Promise<void> {
    const r = await this.updater.onCrashed(appId);
    if (!r.rolledBack) return;
    const back = await this.updater.current(appId);
    const ref = back ? serverRef(back) : this.builtins.get(appId);
    this.pendingBundles.delete(appId);
    if (ref) {
      this.bundles.set(appId, ref);
      this.lifecycle.register(ref);
    }
    showToast(`${ref?.manifest.name ?? appId} ${r.from} kept crashing, so it was rolled back to ${r.to ?? 'the built-in version'}.`, 'error', 8000);
  }

  private async subscribeRealtime(): Promise<void> {
    for (const c of (await this.sync.store.getMeta<string[]>('tracked')) ?? []) {
      if (this.realtime.has(c)) continue;
      try {
        this.realtime.set(c, await this.server.subscribe(c, (rec) => void this.sync.onServerRecord(c, rec)));
      } catch (err) {
        log.warn('sync.realtime_failed', { collection: c, error: (err as Error).message });
      }
    }
  }

  /** 401/403 during sync: try a silent refresh, otherwise ask the owner to sign in (spec §Failure handling). */
  private async recoverAuth(): Promise<void> {
    const user = await this.server.restore();
    if (user) {
      this.sync.resumeAfterAuth();
      return;
    }
    showToast('Your session expired. Sign in again to resume sync.', 'error', 8000);
  }

  async signOut(): Promise<void> {
    this.lifecycle.destroyAll();
    await this.server.signOut();
    this.state.update((s) => ({ ...s, user: null }));
  }

  async refreshReachability(): Promise<Reachability> {
    const r = await this.server.health();
    this.state.update((s) => ({ ...s, reachability: r }));
    this.sync.setOnline(r.state === 'online');
    return r;
  }

  async setSafeMode(on: boolean): Promise<void> {
    await this.broker.setPref('safeMode', on ? '1' : '0');
    this.lifecycle.setSafeMode(on);
    this.state.update((s) => ({ ...s, safeMode: on }));
    log.info('shell.safe_mode', { on });
  }

  async setTheme(theme: ShellState['theme']): Promise<void> {
    await this.broker.setPref('theme', theme);
    this.state.update((s) => ({ ...s, theme }));
  }

  // --- consent and permissions (spec §Permissions; M4 subset with ADR-010) ---

  private askConsent(appId: string, manifest: Manifest, scope: string): Promise<void> {
    const key = `${appId}\u0000${scope}`;
    const existing = this.consentPending.get(key);
    if (existing) return existing;
    const p = new Promise<void>((resolve) => {
      this.consentQueue.push({ req: { appId, appName: manifest.name, scope }, resolve });
      if (!this.consent.get()) this.consent.set(this.consentQueue[0]?.req ?? null);
    }).finally(() => this.consentPending.delete(key));
    this.consentPending.set(key, p);
    return p;
  }

  /** Called by the consent sheet. Decision is stored before the waiting call is re-checked. */
  decideConsent(decision: Decision | 'dismiss'): void {
    const head = this.consentQueue.shift();
    if (!head) return;
    if (decision !== 'dismiss') this.grants.set(head.req.appId, head.req.scope, decision);
    log.info('consent.decided', { appId: head.req.appId, scope: head.req.scope, decision });
    head.resolve();
    this.consent.set(this.consentQueue[0]?.req ?? null);
  }

  /** The app went away while its sheet was queued: answer "not now" (no decision recorded). */
  private dismissConsent(appId: string): void {
    const keep: typeof this.consentQueue = [];
    for (const q of this.consentQueue) {
      if (q.req.appId === appId) q.resolve();
      else keep.push(q);
    }
    this.consentQueue = keep;
    if (this.consent.get()?.appId === appId) this.consent.set(keep[0]?.req ?? null);
  }

  /** Settings → Permissions: forget a decision and end the app's session so it takes effect now. */
  resetGrant(appId: string, scope: string): void {
    this.grants.delete(appId, scope);
    log.info('consent.reset', { appId, scope });
    if (this.lifecycle.get(appId)?.state === 'active' || this.lifecycle.get(appId)?.state === 'suspended') {
      this.lifecycle.close(appId, 'permission_revoked');
      this.onAppClosed(appId);
    }
  }

  statuses(fn: (s: readonly AppStatus[]) => void): () => void {
    return this.lifecycle.subscribe(fn);
  }
}

function serverRef(b: InstalledBundle): BundleRef {
  return { manifest: b.manifest, source: 'server', base: `/installed/${b.manifest.id}/${b.manifest.version}/`, loadHtml: b.loadHtml };
}

export function syncStatus(r: Reachability): SyncStatus {
  if (r.state === 'online') return { label: 'Synced', detail: `Server reachable (${r.ms} ms)` };
  if (r.state === 'error') return { label: 'Error', detail: r.message };
  return { label: 'Offline', detail: 'Server unreachable' };
}
