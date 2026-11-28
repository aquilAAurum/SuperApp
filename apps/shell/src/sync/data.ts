import type { SyncStore, MirrorEntry, OutboxRow, SyncRecord } from './store.ts';
import { matches, parseFilter, sortRecords } from './filter.ts';
import { ShellError } from '../bridge/types.ts';

/** Fields the server owns; subapp payloads may not set them (mirrors server/pb_hooks/lib/ops.js). */
export const RESERVED_FIELDS = ['id', 'version', 'deleted', 'owner', 'origin_device', 'created', 'updated', 'collectionId', 'collectionName', 'expand'];

export function clean(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!RESERVED_FIELDS.includes(k)) out[k] = v;
  return out;
}

/** What a subapp sees: the optimistic record, `version` = confirmed + pending local changes. */
export function visible(e: MirrorEntry): SyncRecord {
  return { ...e.record, version: e.confirmedVersion + e.pending };
}

export interface DataDeps {
  newRecordId: () => string;
  newOpId: () => string;
  now: () => number;
  /** Called after every local change (subscriptions, header count, worker kick). */
  onLocalChange: (collection: string, ids: string[]) => void;
}

export interface ListQuery {
  filter?: string;
  sort?: string;
  page?: number;
  perPage?: number;
}

/**
 * Local half of the write and read paths (spec §Sync): writes go to the mirror and the outbox in one
 * commit and return immediately with `pending: true`; reads come from the mirror.
 */
export class DataService {
  constructor(
    private readonly store: SyncStore,
    private readonly deps: DataDeps,
  ) {}

  private row(appId: string, collection: string, recordId: string, op: OutboxRow['op'], payload: Record<string, unknown>, baseVersion: number | null): Omit<OutboxRow, 'seq'> {
    return {
      opId: this.deps.newOpId(),
      appId,
      collection,
      recordId,
      op,
      payload,
      baseVersion,
      attempts: 0,
      status: 'queued',
      createdAt: new Date(this.deps.now()).toISOString(),
      nextAttemptAt: 0,
      lastError: null,
    };
  }

  async create(appId: string, collection: string, data: Record<string, unknown>, id?: string): Promise<{ record: SyncRecord; pending: true }> {
    const recordId = id ?? this.deps.newRecordId();
    const existing = await this.store.getEntry(collection, recordId);
    if (existing) throw new ShellError('CONFLICT', `Record ${recordId} already exists.`);
    const payload = clean(data);
    const entry: MirrorEntry = { collection, record: { ...payload, id: recordId, deleted: false }, confirmedVersion: 0, pending: 1 };
    await this.store.applyLocalWrite(entry, this.row(appId, collection, recordId, 'create', payload, null));
    this.deps.onLocalChange(collection, [recordId]);
    return { record: visible(entry), pending: true };
  }

  async update(appId: string, collection: string, id: string, data: Record<string, unknown>, baseVersion?: number): Promise<{ record: SyncRecord; pending: true }> {
    const e = await this.store.getEntry(collection, id);
    if (!e || e.record.deleted) throw new ShellError('NOT_FOUND', `Record ${id} not found.`);
    const current = e.confirmedVersion + e.pending;
    if (baseVersion !== undefined && baseVersion !== current) throw new ShellError('CONFLICT', `Record ${id} is at version ${current}, not ${baseVersion}.`);
    const payload = clean(data);
    // Each confirmed op bumps the server version by exactly one, so the version this op will be
    // checked against is known at enqueue time even with earlier ops still queued.
    const entry: MirrorEntry = { ...e, record: { ...e.record, ...payload }, pending: e.pending + 1 };
    await this.store.applyLocalWrite(entry, this.row(appId, collection, id, 'update', payload, current));
    this.deps.onLocalChange(collection, [id]);
    return { record: visible(entry), pending: true };
  }

  async delete(appId: string, collection: string, id: string): Promise<{ pending: true }> {
    const e = await this.store.getEntry(collection, id);
    if (!e || e.record.deleted) throw new ShellError('NOT_FOUND', `Record ${id} not found.`);
    const current = e.confirmedVersion + e.pending;
    const entry: MirrorEntry = { ...e, record: { ...e.record, deleted: true }, pending: e.pending + 1 };
    await this.store.applyLocalWrite(entry, this.row(appId, collection, id, 'delete', {}, current));
    this.deps.onLocalChange(collection, [id]);
    return { pending: true };
  }

  async get(collection: string, id: string): Promise<SyncRecord | null> {
    const e = await this.store.getEntry(collection, id);
    return e && !e.record.deleted ? visible(e) : null;
  }

  async list(collection: string, q: ListQuery = {}): Promise<{ items: SyncRecord[]; page: number; perPage: number; totalItems: number; pending: boolean }> {
    const clauses = parseFilter(q.filter);
    if (clauses === null) throw new ShellError('INVALID_PARAMS', "filter supports field = value / field != value joined by '&&'.");
    const entries = (await this.store.listEntries(collection)).filter((e) => !e.record.deleted);
    const all = sortRecords(entries.map(visible).filter((r) => matches(r, clauses)), q.sort);
    const perPage = q.perPage ?? 100;
    const page = q.page ?? 1;
    return {
      items: all.slice((page - 1) * perPage, page * perPage),
      page,
      perPage,
      totalItems: all.length,
      pending: entries.some((e) => e.pending > 0),
    };
  }

  /**
   * Merge server records (catch-up query or realtime) into the mirror. Records with unconfirmed local
   * changes are left alone; their outbox rows will confirm or conflict. Returns the ids that changed.
   */
  async applyServerRecords(collection: string, records: SyncRecord[]): Promise<string[]> {
    const changed: MirrorEntry[] = [];
    // One range read for the collection, not one native round trip per record (a first catch-up is thousands).
    const existing = records.length > 1 ? new Map((await this.store.listEntries(collection)).map((e) => [e.record.id, e])) : null;
    for (const r of records) {
      const e = existing ? existing.get(r.id) : await this.store.getEntry(collection, r.id);
      if (e && e.pending > 0) continue;
      const version = Number(r.version ?? 0);
      if (e && e.confirmedVersion >= version) continue;
      changed.push({ collection, record: stripMeta(r), confirmedVersion: version, pending: 0 });
    }
    if (changed.length) await this.store.commit({ entries: changed });
    return changed.map((c) => c.record.id);
  }
}

export function stripMeta(r: SyncRecord): SyncRecord {
  const { collectionId: _c, collectionName: _n, expand: _e, ...rest } = r as SyncRecord & { collectionId?: unknown; collectionName?: unknown; expand?: unknown };
  return rest as SyncRecord;
}
