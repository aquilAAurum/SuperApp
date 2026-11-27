import type { Logger } from '../core/logger.ts';
import { stripMeta } from './data.ts';
import type { MirrorEntry, OutboxRow, SyncRecord, SyncStore } from './store.ts';

/** Result of sending one op to POST /api/sa/ops. */
export type SendResult =
  | { kind: 'offline' } // no route to the server: rows stay queued, attempts unchanged
  | { kind: 'timeout' }
  | { kind: 'http'; status: number; body: Record<string, unknown> };

export interface OpTransport {
  send(row: OutboxRow): Promise<SendResult>;
}

export interface WorkerDeps {
  store: SyncStore;
  transport: OpTransport;
  logger: Logger;
  now?: () => number;
  random?: () => number;
  maxParallel?: number;
  maxAttempts?: number;
  /** A record now has its server-confirmed state (emit data.changed). */
  onApplied?: (collection: string, id: string) => void;
  /** A row moved to dead or conflict (emit data.sync_failed to its app, show in Needs attention). */
  onFailed?: (row: OutboxRow) => void;
  /** 401/403 from the server: pause and try to refresh the session. */
  onAuthError?: () => void;
}

export interface RunSummary {
  sent: number;
  done: number;
  offline: boolean;
  pausedForAuth: boolean;
}

export interface OutboxStatusSummary {
  queued: number;
  dead: number;
  conflict: number;
  oldestCreatedAt: string | null;
}

/** Exponential backoff 2 s → 5 min with full jitter (spec §Failure handling). */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const cap = Math.min(300_000, 2_000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(cap / 2 + (random() * cap) / 2);
}

const recordKey = (r: { collection: string; recordId: string }) => `${r.collection}/${r.recordId}`;

/**
 * Sends outbox rows in order per record (never reordered), up to 4 records in parallel, with the
 * opId as idempotency key (spec §Sync write path steps 4-6 and §Integrity).
 */
export class SyncWorker {
  private running: Promise<RunSummary> | null = null;
  private rerun = false;
  private authPaused = false;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly deps: WorkerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? Math.random;
  }

  get pausedForAuth(): boolean {
    return this.authPaused;
  }

  resumeAfterAuth(): void {
    this.authPaused = false;
  }

  /** Runs until nothing is eligible. Concurrent calls coalesce into one extra pass. */
  run(): Promise<RunSummary> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      const total: RunSummary = { sent: 0, done: 0, offline: false, pausedForAuth: false };
      try {
        do {
          this.rerun = false;
          for (;;) {
            const r = await this.pass();
            total.sent += r.sent;
            total.done += r.done;
            total.offline ||= r.offline;
            total.pausedForAuth ||= r.pausedForAuth;
            if (r.sent === 0 || r.offline || r.pausedForAuth) break;
          }
        } while (this.rerun && !total.offline && !total.pausedForAuth);
      } finally {
        this.running = null;
      }
      return total;
    })();
    return this.running;
  }

  /** One round: the head row of each record, if due, sent in parallel batches. */
  private async pass(): Promise<RunSummary> {
    const res: RunSummary = { sent: 0, done: 0, offline: false, pausedForAuth: false };
    if (this.authPaused) return { ...res, pausedForAuth: true };
    const rows = await this.deps.store.outbox();
    const heads = new Map<string, OutboxRow>();
    for (const r of rows) if (!heads.has(recordKey(r))) heads.set(recordKey(r), r);
    const due = [...heads.values()].filter((r) => r.status === 'queued' && r.nextAttemptAt <= this.now());
    const max = this.deps.maxParallel ?? 4;
    for (let i = 0; i < due.length; i += max) {
      const batch = due.slice(i, i + max);
      const results = await Promise.all(batch.map((row) => this.deps.transport.send(row).catch((): SendResult => ({ kind: 'offline' }))));
      for (let j = 0; j < batch.length; j++) {
        const outcome = await this.handle(batch[j]!, results[j]!);
        res.sent++;
        if (outcome === 'done') res.done++;
        if (outcome === 'offline') res.offline = true;
        if (outcome === 'auth') res.pausedForAuth = true;
      }
      if (res.offline || res.pausedForAuth) break;
    }
    return res;
  }

  private async handle(row: OutboxRow, result: SendResult): Promise<'done' | 'retry' | 'failed' | 'offline' | 'auth'> {
    const { store, logger } = this.deps;
    if (result.kind === 'offline') return 'offline';
    if (result.kind === 'timeout') return this.retryLater(row, 'Request timed out.');

    const { status, body } = result;
    if (status >= 200 && status < 300) {
      const server = stripMeta(body.record as SyncRecord);
      const e = await store.getEntry(row.collection, row.recordId);
      const pending = Math.max(0, (e?.pending ?? 1) - 1);
      const entry: MirrorEntry = {
        collection: row.collection,
        record: pending === 0 ? server : { ...(e?.record ?? server) },
        confirmedVersion: Number(server.version ?? 0),
        pending,
      };
      await store.commit({ entries: [entry], removeRows: [row.seq] });
      logger.debug('sync.op_done', { appId: row.appId, collection: row.collection, op: row.op, replayed: Boolean(body.replayed) });
      this.deps.onApplied?.(row.collection, row.recordId);
      return 'done';
    }
    if (status === 401 || (status === 403 && body.code !== 'SCOPE_DENIED')) {
      this.authPaused = true;
      logger.warn('sync.paused_auth', { status });
      this.deps.onAuthError?.();
      return 'auth';
    }
    if (status === 409 || status === 404) {
      const server = (body.server as SyncRecord | undefined) ? stripMeta(body.server as SyncRecord) : null;
      const others = (await store.outbox()).filter((r) => recordKey(r) === recordKey(row) && r.seq !== row.seq).length;
      const e = await store.getEntry(row.collection, row.recordId);
      const entries: MirrorEntry[] = [];
      // Server wins in the mirror; the local change is kept on the row for review.
      if (server) entries.push({ collection: row.collection, record: server, confirmedVersion: Number(server.version ?? 0), pending: others });
      else if (e) entries.push({ ...e, record: { ...e.record, deleted: true }, pending: others });
      const failed: OutboxRow = {
        ...row,
        status: 'conflict',
        conflictKind: status === 404 ? 'deleted_on_server' : 'version',
        server,
        lastError: String(body.message ?? (status === 404 ? 'Record deleted on the server.' : 'Version conflict.')),
      };
      await store.commit({ entries, rows: [failed] });
      logger.warn('sync.conflict', { appId: row.appId, collection: row.collection, status });
      this.deps.onFailed?.(failed);
      return 'failed';
    }
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      const dead: OutboxRow = { ...row, status: 'dead', attempts: row.attempts + 1, lastError: String(body.message ?? `HTTP ${status}`) };
      await store.commit({ rows: [dead] });
      logger.warn('sync.dead', { appId: row.appId, collection: row.collection, status });
      this.deps.onFailed?.(dead);
      return 'failed';
    }
    return this.retryLater(row, String(body.message ?? `HTTP ${status}`));
  }

  private async retryLater(row: OutboxRow, error: string): Promise<'retry' | 'failed'> {
    const attempts = row.attempts + 1;
    if (attempts >= (this.deps.maxAttempts ?? 10)) {
      const dead: OutboxRow = { ...row, attempts, status: 'dead', lastError: error };
      await this.deps.store.commit({ rows: [dead] });
      this.deps.onFailed?.(dead);
      return 'failed';
    }
    await this.deps.store.commit({ rows: [{ ...row, attempts, lastError: error, nextAttemptAt: this.now() + backoffMs(attempts, this.random) }] });
    return 'retry';
  }

  /** Earliest time a queued row is due (for scheduling), or null. */
  async nextDueAt(): Promise<number | null> {
    const due = (await this.deps.store.outbox()).filter((r) => r.status === 'queued').map((r) => r.nextAttemptAt);
    return due.length ? Math.min(...due) : null;
  }

  async summary(): Promise<OutboxStatusSummary> {
    const rows = await this.deps.store.outbox();
    return {
      queued: rows.filter((r) => r.status === 'queued').length,
      dead: rows.filter((r) => r.status === 'dead').length,
      conflict: rows.filter((r) => r.status === 'conflict').length,
      oldestCreatedAt: rows.length ? rows.reduce((a, r) => (r.createdAt < a ? r.createdAt : a), rows[0]!.createdAt) : null,
    };
  }
}
