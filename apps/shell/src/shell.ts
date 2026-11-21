/**
 * Composition root. Wires logger → router → handshake → lifecycle and exposes Svelte-compatible
 * stores to the UI. No domain features live here (spec: the shell is a platform).
 */
import { API_VERSION, type Capabilities, METHODS, type MethodName } from '@superapp/contracts';
import { log, type LogEntry } from './core/logger.ts';
import { RingLog } from './core/observable.ts';
import { BridgeRouter } from './bridge/router.ts';
import { HandshakeGuard } from './bridge/handshake.ts';
import { MemoryGrantStore, grantedScopes } from './bridge/permissions.ts';
import { coreHandlers } from './bridge/handlers.ts';
import { SubappLifecycle, type AppStatus } from './host/lifecycle.ts';
import { domFrameFactory } from './host/frames.ts';
import { loadBuiltinBundles, type BundleRef } from './host/bundles.ts';
import { CapabilityBroker } from './native/CapabilityBroker.ts';
import { ServerClient, type Reachability, type SignedInUser } from './server/ServerClient.ts';
import { writable, type Writable } from './ui/store.ts';
import type { Handler, PortLike } from './bridge/types.ts';

export const SHELL_VERSION = __SHELL_VERSION__;

export type SyncStatus = { label: 'Synced' | 'Offline' | 'Error'; detail: string };

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
  readonly titles: Writable<Record<string, string>> = writable({});
  readonly state: Writable<ShellState> = writable<ShellState>({
    user: null,
    deviceId: null,
    serverUrl: null,
    reachability: { state: 'offline' },
    safeMode: false,
    theme: 'system',
  });
  /** Set by the UI: called when an app asks to close or crashes while visible. */
  onAppClosed: (appId: string) => void = () => undefined;

  private readonly handlers: Partial<Record<MethodName, Handler>>;
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
    this.router = new BridgeRouter({ logger: log, grants: this.grants, handlers: this.handlers });
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
    const [url, safe, theme] = await Promise.all([this.broker.getPref('serverUrl'), this.broker.getPref('safeMode'), this.broker.getPref('theme')]);
    this.state.update((s) => ({ ...s, safeMode: safe === '1', theme: theme === 'light' || theme === 'dark' ? theme : 'system' }));
    for (const b of await loadBuiltinBundles(log)) {
      this.bundles.set(b.manifest.id, b);
      this.lifecycle.register(b);
    }
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
  }

  async signOut(): Promise<void> {
    this.lifecycle.destroyAll();
    await this.server.signOut();
    this.state.update((s) => ({ ...s, user: null }));
  }

  async refreshReachability(): Promise<Reachability> {
    const r = await this.server.health();
    this.state.update((s) => ({ ...s, reachability: r }));
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

  statuses(fn: (s: readonly AppStatus[]) => void): () => void {
    return this.lifecycle.subscribe(fn);
  }
}

export function syncStatus(r: Reachability): SyncStatus {
  if (r.state === 'online') return { label: 'Synced', detail: `Server reachable (${r.ms} ms)` };
  if (r.state === 'error') return { label: 'Error', detail: r.message };
  return { label: 'Offline', detail: 'Server unreachable' };
}
