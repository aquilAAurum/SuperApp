import type { MirrorEntry, OutboxRow, SyncStore } from './store.ts';
import { clean } from './data.ts';

export type Resolution = 'retry' | 'discard' | 'keep_server' | 'recreate';

export interface ResolveDeps {
  newRecordId: () => string;
  /** Rebased or recreated ops are new operations: they need a fresh idempotency key, or the server
   *  would (correctly) replay the stored conflict result for the old opId. */
  newOpId: () => string;
  /** Called when the mirror needs the server copy of a record after local changes were dropped. */
  refetch: (collection: string, id: string) => void;
}

const sameRecord = (a: OutboxRow, b: OutboxRow) => a.collection === b.collection && a.recordId === b.recordId;

/**
 * Sync centre → Needs attention actions (spec §Sync centre):
 *   retry       dead: try again with the same opId (a lost response is then replayed, not duplicated). conflict: re-apply my change on top of the server version.
 *   discard     drop this change and any later unsent changes to the same record.
 *   keep_server same as discard, for conflicts (the mirror already shows the server version).
 *   recreate    deleted on server: recreate the record (new id) from my local copy.
 * Returns the ids that changed so callers can notify subscribers.
 */
export async function resolveRow(store: SyncStore, seq: number, action: Resolution, deps: ResolveDeps): Promise<{ collection: string; ids: string[] }> {
  const rows = await store.outbox();
  const row = rows.find((r) => r.seq === seq);
  if (!row) throw new Error(`Outbox row ${seq} not found`);
  const later = rows.filter((r) => sameRecord(r, row) && r.seq > row.seq);
  const entry = await store.getEntry(row.collection, row.recordId);

  if (action === 'retry' && row.status === 'dead') {
    await store.commit({ rows: [{ ...row, status: 'queued', attempts: 0, nextAttemptAt: 0, lastError: null }] });
    return { collection: row.collection, ids: [row.recordId] };
  }

  if (action === 'retry' && row.status === 'conflict' && row.conflictKind === 'version' && entry) {
    // Rebase: this row and every later row for the record are renumbered on the server's version.
    const chain = [row, ...later];
    const base = entry.confirmedVersion;
    const rebased = chain.map((r, i) => ({ ...r, opId: deps.newOpId(), status: 'queued' as const, attempts: 0, nextAttemptAt: 0, lastError: null, server: null, conflictKind: undefined, baseVersion: r.op === 'create' ? null : base + i }));
    let record = { ...entry.record };
    for (const r of chain) record = r.op === 'delete' ? { ...record, deleted: true } : { ...record, ...r.payload };
    const next: MirrorEntry = { ...entry, record, pending: chain.length };
    await store.commit({ entries: [next], rows: rebased });
    return { collection: row.collection, ids: [row.recordId] };
  }

  if (action === 'recreate' || (action === 'retry' && row.conflictKind === 'deleted_on_server')) {
    const newId = deps.newRecordId();
    const base = { ...(row.server ?? entry?.record ?? {}) } as Record<string, unknown>;
    let payload = clean(base);
    for (const r of [row, ...later]) if (r.op !== 'delete') payload = { ...payload, ...r.payload };
    const created: OutboxRow = { ...row, opId: deps.newOpId(), recordId: newId, op: 'create', payload, baseVersion: null, status: 'queued', attempts: 0, nextAttemptAt: 0, lastError: null, server: null, conflictKind: undefined };
    const newEntry: MirrorEntry = { collection: row.collection, record: { ...payload, id: newId, deleted: false }, confirmedVersion: 0, pending: 1 };
    await store.commit({ entries: [newEntry], rows: [created], removeRows: later.map((r) => r.seq) });
    return { collection: row.collection, ids: [row.recordId, newId] };
  }

  // discard / keep_server
  const remove = [row.seq, ...later.map((r) => r.seq)];
  if (entry && entry.confirmedVersion === 0 && !row.server) {
    await store.commit({ removeRows: remove, removeEntries: [{ collection: row.collection, id: row.recordId }] });
  } else {
    const server = row.server;
    const next: MirrorEntry | null = server
      ? { collection: row.collection, record: server, confirmedVersion: Number(server.version ?? 0), pending: 0 }
      : entry
        ? { ...entry, pending: 0 }
        : null;
    await store.commit({ removeRows: remove, entries: next ? [next] : [] });
    if (!server) deps.refetch(row.collection, row.recordId);
  }
  return { collection: row.collection, ids: [row.recordId] };
}
