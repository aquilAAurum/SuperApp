/**
 * Test double for PocketBase that runs the real server write-path logic
 * (server/pb_hooks/lib/ops.js) over an in-memory store, so shell sync tests exercise the same
 * idempotency and version rules the server enforces. Used by unit tests and Playwright fixtures.
 */
import { createRequire } from 'node:module';
import type { OutboxRow } from '../../src/sync/store.ts';
import type { OpTransport, SendResult } from '../../src/sync/worker.ts';

type Rec = Record<string, unknown> & { id: string; version: number; owner: string; deleted: boolean; updated: string };
type ApplyOp = (store: unknown, op: unknown, ctx: { userId: string; deviceId?: string }) => { status: number; body: Record<string, unknown> };

const require = createRequire(import.meta.url);
const { applyOp } = require('../../../../server/pb_hooks/lib/ops.js') as { applyOp: ApplyOp };

export class FakeOpsServer implements OpTransport {
  records = new Map<string, Rec>();
  processed = new Map<string, { owner: string; status: number; body: Record<string, unknown> }>();
  requests = 0;
  online = true;
  /** Fail the next N requests with this HTTP status. */
  failNext: { count: number; status: number } = { count: 0, status: 500 };
  private clock = 0;

  constructor(
    readonly userId = 'user00000000001',
    readonly synced: (c: string) => boolean = (c) => c.startsWith('core_') || c.startsWith('hello_'),
  ) {}

  private store() {
    return {
      isSynced: this.synced,
      findProcessed: (opId: string) => this.processed.get(opId) ?? null,
      findRecord: (c: string, id: string) => {
        const r = this.records.get(`${c}/${id}`);
        return r ? { ...r } : null;
      },
      create: (c: string, data: Record<string, unknown>) => {
        const r = { ...data, version: 1, updated: this.tick() } as Rec;
        this.records.set(`${c}/${r.id}`, r);
        return { ...r };
      },
      update: (c: string, id: string, patch: Record<string, unknown>) => {
        const prev = this.records.get(`${c}/${id}`)!;
        const r = { ...prev, ...patch, version: prev.version + 1, updated: this.tick() };
        this.records.set(`${c}/${id}`, r);
        return { ...r };
      },
      markProcessed: (opId: string, x: { owner: string; status: number; body: Record<string, unknown> }) => {
        this.processed.set(opId, x);
      },
    };
  }

  private tick(): string {
    return new Date(1_700_000_000_000 + ++this.clock * 1000).toISOString();
  }

  /** Server-side edit by "another device": bumps the version like the server hook would. */
  editOnServer(collection: string, id: string, patch: Record<string, unknown>): Rec {
    return this.store().update(collection, id, patch) as Rec;
  }

  apply(op: unknown): { status: number; body: Record<string, unknown> } {
    this.requests++;
    return applyOp(this.store(), op, { userId: this.userId });
  }

  async send(row: OutboxRow): Promise<SendResult> {
    if (!this.online) return { kind: 'offline' };
    if (this.failNext.count > 0) {
      this.failNext.count--;
      this.requests++;
      return { kind: 'http', status: this.failNext.status, body: { message: 'injected failure' } };
    }
    const { status, body } = this.apply({ opId: row.opId, collection: row.collection, recordId: row.recordId, op: row.op, payload: row.payload, baseVersion: row.baseVersion ?? undefined });
    return { kind: 'http', status, body };
  }

  liveRecords(collection: string): Rec[] {
    return [...this.records.entries()].filter(([k, r]) => k.startsWith(`${collection}/`) && !r.deleted).map(([, r]) => r);
  }

  since(collection: string, since: string): Rec[] {
    return [...this.records.entries()].filter(([k, r]) => k.startsWith(`${collection}/`) && r.updated >= since).map(([, r]) => ({ ...r }));
  }
}
