import { HANDSHAKE_TIMEOUT_MS, MAX_SUSPENDED_APPS, type Manifest } from '@superapp/contracts';
import type { HandshakeGuard, WindowLike } from '../bridge/handshake.ts';
import type { BridgeRouter } from '../bridge/router.ts';
import type { Logger } from '../core/logger.ts';

/** Spec §Lifecycle. */
export type AppState = 'installed' | 'starting' | 'active' | 'suspended' | 'crashed' | 'disabled';

export interface InstalledApp {
  manifest: Manifest;
  /** Where the bundle comes from; `builtin` ships inside the shell (reference apps), `server` from M5. */
  source: 'builtin' | 'server' | 'dev';
}

/** One iframe. Created by the DOM layer; the lifecycle owns its destruction (CORE-15). */
export interface FrameHandle {
  window: WindowLike;
  show(): void;
  hide(): void;
  destroy(): void;
}

export interface AppStatus {
  appId: string;
  state: AppState;
  lastError: string | null;
  handshakeMs: number | null;
}

export interface LifecycleDeps {
  createFrame: (app: InstalledApp) => Promise<FrameHandle>;
  handshake: HandshakeGuard;
  router: BridgeRouter;
  logger: Logger;
  setTimer?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
  maxSuspended?: number;
  startTimeoutMs?: number;
}

export class SubappLifecycle {
  private apps = new Map<string, InstalledApp>();
  private status = new Map<string, AppStatus>();
  private frames = new Map<string, FrameHandle>();
  private timers = new Map<string, () => void>();
  private suspended: string[] = []; // oldest first
  private activeId: string | null = null;
  private subs = new Set<(s: readonly AppStatus[]) => void>();
  private safeMode = false;
  private readonly setTimer: (fn: () => void, ms: number) => () => void;
  private readonly now: () => number;

  constructor(private readonly deps: LifecycleDeps) {
    this.setTimer =
      deps.setTimer ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      });
    this.now = deps.now ?? (() => Date.now());
  }

  register(app: InstalledApp): void {
    this.apps.set(app.manifest.id, app);
    if (!this.status.has(app.manifest.id)) {
      this.status.set(app.manifest.id, { appId: app.manifest.id, state: this.safeMode ? 'disabled' : 'installed', lastError: null, handshakeMs: null });
    }
    this.notify();
  }

  get(appId: string): AppStatus | undefined {
    return this.status.get(appId);
  }

  get active(): string | null {
    return this.activeId;
  }

  liveFrameCount(): number {
    return this.frames.size;
  }

  /** Safe mode: every subapp disabled and torn down (spec §Diagnostics). */
  setSafeMode(on: boolean): void {
    this.safeMode = on;
    for (const id of this.apps.keys()) {
      if (on) {
        this.teardown(id, 'safe_mode');
        this.set(id, { state: 'disabled' });
      } else if (this.status.get(id)?.state === 'disabled') {
        this.set(id, { state: 'installed' });
      }
    }
  }

  setDisabled(appId: string, disabled: boolean): void {
    if (disabled) {
      this.teardown(appId, 'disabled');
      this.set(appId, { state: 'disabled' });
    } else if (!this.safeMode) {
      this.set(appId, { state: 'installed' });
    }
  }

  async launch(appId: string): Promise<AppStatus> {
    const app = this.apps.get(appId);
    const st = this.status.get(appId);
    if (!app || !st) throw new Error(`Unknown app ${appId}`);
    if (st.state === 'disabled') return st;
    if (this.activeId === appId && (st.state === 'active' || st.state === 'starting')) return st;

    if (this.activeId && this.activeId !== appId) this.suspend(this.activeId);

    if (st.state === 'suspended' && this.frames.has(appId)) {
      this.suspended = this.suspended.filter((id) => id !== appId);
      this.frames.get(appId)!.show();
      this.activeId = appId;
      this.set(appId, { state: 'active' });
      return this.status.get(appId)!;
    }

    this.teardown(appId, 'relaunch');
    this.activeId = appId;
    this.set(appId, { state: 'starting', lastError: null, handshakeMs: null });
    const createdAt = this.now();
    let frame: FrameHandle;
    try {
      frame = await this.deps.createFrame(app);
    } catch (err) {
      this.crash(appId, `Could not load bundle: ${(err as Error).message}`);
      return this.status.get(appId)!;
    }
    this.frames.set(appId, frame);
    this.deps.handshake.expect({
      appId,
      manifest: app.manifest,
      window: frame.window,
      createdAt,
      onConnected: ({ ms }) => {
        this.clearTimer(appId);
        this.set(appId, { state: this.activeId === appId ? 'active' : 'suspended', handshakeMs: ms });
        this.deps.logger.info('subapp.started', { appId, handshakeMs: ms });
      },
    });
    this.timers.set(
      appId,
      this.setTimer(() => this.crash(appId, `No hello within ${(this.deps.startTimeoutMs ?? HANDSHAKE_TIMEOUT_MS) / 1000} s.`), this.deps.startTimeoutMs ?? HANDSHAKE_TIMEOUT_MS),
    );
    frame.show();
    return this.status.get(appId)!;
  }

  /** Hide the active app. Keeps up to N suspended iframes, destroying the least recently used. */
  suspend(appId: string): void {
    const frame = this.frames.get(appId);
    if (this.activeId === appId) this.activeId = null;
    if (!frame) return;
    frame.hide();
    const st = this.status.get(appId);
    if (st && st.state === 'active') this.set(appId, { state: 'suspended' });
    this.suspended = [...this.suspended.filter((id) => id !== appId), appId];
    const max = this.deps.maxSuspended ?? MAX_SUSPENDED_APPS;
    while (this.suspended.length > max) {
      const oldest = this.suspended.shift()!;
      this.teardown(oldest, 'evicted');
      this.set(oldest, { state: 'installed' });
    }
  }

  /** Close (app.close, back to launcher with destroy, or session revoked). */
  close(appId: string, reason = 'closed'): void {
    this.teardown(appId, reason);
    const st = this.status.get(appId);
    if (st && st.state !== 'disabled' && st.state !== 'crashed') this.set(appId, { state: 'installed' });
  }

  crash(appId: string, reason: string): void {
    this.deps.logger.error('subapp.crashed', { appId, reason });
    this.deps.router.reject(appId, 'lifecycle', 'TIMEOUT', reason);
    this.teardown(appId, 'crashed');
    this.set(appId, { state: 'crashed', lastError: reason });
  }

  /** Destroy everything (shell shutdown / tests). */
  destroyAll(): void {
    for (const id of [...this.frames.keys()]) this.close(id, 'shutdown');
  }

  subscribe(fn: (s: readonly AppStatus[]) => void): () => void {
    this.subs.add(fn);
    fn([...this.status.values()]);
    return () => this.subs.delete(fn);
  }

  private teardown(appId: string, reason: string): void {
    this.clearTimer(appId);
    const frame = this.frames.get(appId);
    if (frame) {
      this.deps.handshake.forget(frame.window);
      frame.destroy();
      this.frames.delete(appId);
    }
    this.deps.router.detach(appId, reason);
    this.suspended = this.suspended.filter((id) => id !== appId);
    if (this.activeId === appId) this.activeId = null;
  }

  private clearTimer(appId: string): void {
    this.timers.get(appId)?.();
    this.timers.delete(appId);
  }

  private set(appId: string, patch: Partial<AppStatus>): void {
    const prev = this.status.get(appId);
    if (!prev) return;
    this.status.set(appId, { ...prev, ...patch });
    this.notify();
  }

  private notify(): void {
    const all = [...this.status.values()];
    for (const s of this.subs) s(all);
  }
}
