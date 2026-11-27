import type { KvBackend, KvWrite } from './kv.ts';

export type SyncRecord = Record<string, unknown> & { id: string; version?: number; deleted?: boolean };

/** One mirrored record plus what the device knows about its server state. */
export interface MirrorEntry {
  collection: string;
  record: SyncRecord;
  /** Last version the server confirmed (0 = never on the server). */
  confirmedVersion: number;
  /** Outbox rows for this record that are not yet confirmed. */
  pending: number;
}

export type OutboxStatus = 'queued' | 'dead' | 'conflict';
export type OpKind = 'create' | 'update' | 'delete';

/** Spec §Sync write path step 2. */
export interface OutboxRow {
  seq: number;
  opId: string;
  appId: string;
  collection: string;
  recordId: string;
  op: OpKind;
  payload: Record<string, unknown>;
  baseVersion: number | null;
  attempts: number;
  status: OutboxStatus;
  createdAt: string;
  nextAttemptAt: number;
  lastError: string | null;
  /** For conflicts: the server's record at the time of the conflict ("both versions kept"). */
  server?: SyncRecord | null;
  conflictKind?: 'version' | 'deleted_on_server';
}

const mirrorKey = (collection: string, id: string) => `${collection}/${id}`;
const outboxKey = (seq: number) => String(seq).padStart(12, '0');

/** Mirror + outbox + meta over a KvBackend. Every mutation is a single atomic commit. */
export class SyncStore {
  constructor(readonly kv: KvBackend) {}

  getEntry(collection: string, id: string): Promise<MirrorEntry | undefined> {
    return this.kv.get<MirrorEntry>('mirror', mirrorKey(collection, id));
  }

  async listEntries(collection: string): Promise<MirrorEntry[]> {
    const all = await this.kv.list<MirrorEntry>('mirror');
    return all.filter((e) => e.value.collection === collection).map((e) => e.value);
  }

  async outbox(): Promise<OutboxRow[]> {
    return (await this.kv.list<OutboxRow>('outbox')).map((e) => e.value);
  }

  getMeta<T>(key: string): Promise<T | undefined> {
    return this.kv.get<T>('meta', key);
  }

  setMeta(key: string, value: unknown): Promise<void> {
    return this.kv.commit([{ table: 'meta', key, value }]);
  }

  /** Writes the optimistic mirror entry and appends the outbox row in one commit (spec §Integrity). */
  async applyLocalWrite(entry: MirrorEntry, row: Omit<OutboxRow, 'seq'>): Promise<OutboxRow> {
    const seq = ((await this.getMeta<number>('outbox.seq')) ?? 0) + 1;
    const full: OutboxRow = { ...row, seq };
    await this.kv.commit([
      { table: 'mirror', key: mirrorKey(entry.collection, entry.record.id), value: entry },
      { table: 'outbox', key: outboxKey(seq), value: full },
      { table: 'meta', key: 'outbox.seq', value: seq },
    ]);
    return full;
  }

  /** Commit a set of mirror and outbox changes together. */
  async commit(changes: { entries?: MirrorEntry[]; rows?: OutboxRow[]; removeRows?: number[]; removeEntries?: { collection: string; id: string }[] }): Promise<void> {
    const writes: KvWrite[] = [];
    for (const e of changes.entries ?? []) writes.push({ table: 'mirror', key: mirrorKey(e.collection, e.record.id), value: e });
    for (const r of changes.rows ?? []) writes.push({ table: 'outbox', key: outboxKey(r.seq), value: r });
    for (const s of changes.removeRows ?? []) writes.push({ table: 'outbox', key: outboxKey(s), value: null });
    for (const r of changes.removeEntries ?? []) writes.push({ table: 'mirror', key: mirrorKey(r.collection, r.id), value: null });
    await this.kv.commit(writes);
  }
}
