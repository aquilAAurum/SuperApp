import type { Logger } from '../core/logger.ts';
import { newRecordId } from '../core/ids.ts';
import { writable, type Writable } from '../ui/store.ts';
import { DataService } from './data.ts';
import type { KvBackend } from './kv.ts';
import { resolveRow, type Resolution } from './resolve.ts';
import { SyncStore, type OutboxRow, type SyncRecord } from './store.ts';
import { SyncWorker, type SendResult } from './worker.ts';

/** Server operations the engine needs (implemented by ServerClient; faked in tests). */
export interface SyncServer {
  sendOp(row: OutboxRow, deviceId: string | null): Promise<SendResult>;
  listSince(collection: string, since: string | null): Promise<SyncRecord[]>;
  getRecord(collection: string, id: string): Promise<SyncRecord | null>;
}

export type SyncLabel = 'Synced' | 'Pending' | 'Offline' | 'Error';

export interface SyncStatus {
  label: SyncLabel;
  queued: number;
  attention: number;
  oldestCreatedAt: string | null;
  lastSyncAt: string | null;
  online: boolean;
  paused: null | 'auth' | 'schema';
  detail: string;
}

export interface EngineDeps {
  kv: KvBackend;
  server: SyncServer;
  logger: Logger;
  /** Push an event to a running app (router.emit). */
  emit: (appId: string, topic: string, payload: unknown) => void;
  deviceId: () => string | null;
  onAuthError?: () => void;
  now?: () => number;
  debounceMs?: number;
}

/**
 * Composes the local data service, the outbox worker and the read-side refresh, and keeps the status
 * the launcher header and Sync centre show (spec §Sync, "fail visibly").
 */
export class SyncEngine {
  readonly store: SyncStore;
  readonly data: DataService;
  readonly worker: SyncWorker;
  readonly status: Writable<SyncStatus>;
  readonly rows: Writable<OutboxRow[]> = writable([]);
  private subs = new Map<string, { appId: string; collection: string }>();
  private nextSub = 1;
  private online = true;
  private paused: SyncStatus['paused'] = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncAt: string | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.store = new SyncStore(deps.kv);
    this.status = writable<SyncStatus>({ label: 'Synced', queued: 0, attention: 0, oldestCreatedAt: null, lastSyncAt: null, online: true, paused: null, detail: '' });
    this.data = new DataService(this.store, {
      newRecordId,
      newOpId: () => crypto.randomUUID(),
      now: this.now,
      onLocalChange: (collection, ids) => {
        this.notify(collection, ids);
        this.schedule();
      },
    });
    this.worker = new SyncWorker({
      store: this.store,
      logger: deps.logger,
      now: this.now,
      transport: { send: (row) => deps.server.sendOp(row, deps.deviceId()) },
      onApplied: (collection, id) => this.notify(collection, [id]),
      onFailed: (row) => {
        deps.emit(row.appId, 'data.sync_failed', { collection: row.collection, recordId: row.recordId, status: row.status, error: row.lastError, opId: row.opId });
        this.notify(row.collection, [row.recordId]);
      },
      onAuthError: () => {
        this.paused = 'auth';
        deps.onAuthError?.();
      },
    });
  }

  // --- subscriptions (data.subscribe / data.unsubscribe) ---

  subscribe(appId: string, collection: string): string {
    const id = `sub${this.nextSub++}`;
    this.subs.set(id, { appId, collection });
    void this.track(collection);
    return id;
  }

  unsubscribe(appId: string, id: string): boolean {
    const s = this.subs.get(id);
    if (!s || s.appId !== appId) return false;
    return this.subs.delete(id);
  }

  /** Called when an app's session ends. */
  dropApp(appId: string): void {
    for (const [id, s] of this.subs) if (s.appId === appId) this.subs.delete(id);
  }

  private watchers = new Map<string, Set<(ids: string[]) => void>>();

  /** Shell screens (Today, Week) listen to collection changes the way apps do through data.changed. */
  watch(collection: string, fn: (ids: string[]) => void): () => void {
    let set = this.watchers.get(collection);
    if (!set) this.watchers.set(collection, (set = new Set()));
    set.add(fn);
    void this.track(collection);
    return () => set.delete(fn);
  }

  private notify(collection: string, ids: string[]): void {
    for (const fn of this.watchers.get(collection) ?? []) fn(ids);
    const seen = new Set<string>();
    for (const s of this.subs.values()) {
      if (s.collection !== collection || seen.has(s.appId)) continue;
      seen.add(s.appId);
      this.deps.emit(s.appId, 'data.changed', { collection, ids });
    }
    void this.refreshStatus();
  }

  // --- scheduling ---

  /** Debounced kick after local writes; also called on connectivity change, resume and a 30 s tick. */
  schedule(delay = this.deps.debounceMs ?? 250): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync();
    }, delay);
  }

  async sync(): Promise<void> {
    if (this.paused) return void (await this.refreshStatus());
    const r = await this.worker.run();
    this.online = !r.offline;
    if (r.done > 0 || (!r.offline && !r.pausedForAuth)) this.lastSyncAt = new Date(this.now()).toISOString();
    await this.refreshStatus();
    const due = await this.worker.nextDueAt();
    if (due !== null && this.online && !this.paused) this.schedule(Math.max(1_000, due - this.now()));
  }

  setOnline(online: boolean): void {
    this.online = online;
    if (online) this.schedule(0);
    void this.refreshStatus();
  }

  resumeAfterAuth(): void {
    if (this.paused !== 'auth') return;
    this.paused = null;
    this.worker.resumeAfterAuth();
    this.schedule(0);
  }

  /** Schema mismatch: the server is newer than this shell. Writes stay queued locally. */
  pauseForSchema(on: boolean): void {
    this.paused = on ? 'schema' : this.paused === 'schema' ? null : this.paused;
    if (!on) this.schedule(0);
    void this.refreshStatus();
  }

  // --- read side ---

  private async track(collection: string): Promise<void> {
    const tracked = (await this.store.getMeta<string[]>('tracked')) ?? [];
    if (!tracked.includes(collection)) await this.store.setMeta('tracked', [...tracked, collection]);
  }

  private refreshing = new Map<string, Promise<string[]>>();
  private refreshedAt = new Map<string, number>();

  /**
   * Catch-up for one collection. One at a time per collection: a call while one is in flight joins
   * it (a subapp paging a large collection used to start a full download per page). With
   * `maxAgeMs`, a catch-up that finished that recently is reused instead of repeated (reads
   * trigger catch-ups; realtime covers changes in between). Resume and subscribe pass no maxAge.
   */
  refresh(collection: string, opts: { maxAgeMs?: number } = {}): Promise<string[]> {
    const inflight = this.refreshing.get(collection);
    if (inflight) return inflight;
    const at = this.refreshedAt.get(collection);
    if (opts.maxAgeMs !== undefined && at !== undefined && this.now() - at < opts.maxAgeMs) return Promise.resolve([]);
    const p = this.runRefresh(collection).finally(() => {
      this.refreshing.delete(collection);
      this.refreshedAt.set(collection, this.now());
    });
    this.refreshing.set(collection, p);
    return p;
  }

  /** Catch-up query for one collection (`updated > lastSyncAt`), merged into the mirror. */
  private async runRefresh(collection: string): Promise<string[]> {
    await this.track(collection);
    if (!this.online) return [];
    try {
      const since = (await this.store.getMeta<string>(`since:${collection}`)) ?? null;
      const records = await this.deps.server.listSince(collection, since);
      const changed = await this.data.applyServerRecords(collection, records);
      const newest = records.reduce<string | null>((m, r) => (typeof r.updated === 'string' && (!m || r.updated > m) ? r.updated : m), since);
      if (newest && newest !== since) await this.store.setMeta(`since:${collection}`, newest);
      if (changed.length) this.notify(collection, changed);
      return changed;
    } catch (err) {
      this.deps.logger.warn('sync.refresh_failed', { collection, error: (err as Error).message });
      return [];
    }
  }

  async catchUpAll(): Promise<void> {
    for (const c of (await this.store.getMeta<string[]>('tracked')) ?? []) await this.refresh(c);
  }

  /** Realtime event from the server (foreground subscription). */
  async onServerRecord(collection: string, record: SyncRecord): Promise<void> {
    const changed = await this.data.applyServerRecords(collection, [record]);
    if (changed.length) this.notify(collection, changed);
  }

  // --- Needs attention ---

  async resolve(seq: number, action: Resolution): Promise<void> {
    const r = await resolveRow(this.store, seq, action, {
      newRecordId,
      newOpId: () => crypto.randomUUID(),
      refetch: (collection, id) => {
        void this.deps.server.getRecord(collection, id).then((rec) => (rec ? this.onServerRecord(collection, rec) : undefined));
      },
    });
    this.deps.logger.info('sync.resolved', { action, collection: r.collection });
    this.notify(r.collection, r.ids);
    this.schedule(0);
  }

  async refreshStatus(): Promise<SyncStatus> {
    const rows = await this.store.outbox();
    this.rows.set(rows);
    const queued = rows.filter((r) => r.status === 'queued').length;
    const attention = rows.length - queued;
    const label: SyncLabel = this.paused || attention > 0 ? 'Error' : !this.online ? 'Offline' : queued > 0 ? 'Pending' : 'Synced';
    const detail =
      this.paused === 'auth' ? 'Sign in again to resume sync.' : this.paused === 'schema' ? 'Server schema is newer than this shell. Update the app.' : attention > 0 ? `${attention} item(s) need attention.` : !this.online ? 'Server unreachable. Changes are saved on this phone.' : queued > 0 ? `${queued} change(s) waiting to sync.` : 'All changes are on the server.';
    const s: SyncStatus = { label, queued, attention, oldestCreatedAt: rows[0]?.createdAt ?? null, lastSyncAt: this.lastSyncAt, online: this.online, paused: this.paused, detail };
    this.status.set(s);
    return s;
  }
}
