import { prefixEnd, type KvBackend, type KvWrite, type Table } from './kv.ts';

/** The SQL surface the CapabilityBroker exposes (the plugin itself is imported only there). */
export interface SqlDatabase {
  execute(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<T[]>;
  /** Runs all statements in one transaction. */
  executeSet(set: { statement: string; values: unknown[] }[]): Promise<void>;
}

/** SQLite backend for Android (encrypted database opened by the broker, ADR-004). */
export class SqliteKv implements KvBackend {
  private ready: Promise<void>;

  constructor(private readonly db: SqlDatabase) {
    this.ready = db.execute('CREATE TABLE IF NOT EXISTS kv (tbl TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (tbl, key))');
  }

  async get<T>(table: Table, key: string): Promise<T | undefined> {
    await this.ready;
    const rows = await this.db.query<{ value: string }>('SELECT value FROM kv WHERE tbl = ? AND key = ?', [table, key]);
    return rows[0] ? (JSON.parse(rows[0].value) as T) : undefined;
  }

  async list<T>(table: Table, prefix?: string): Promise<{ key: string; value: T }[]> {
    await this.ready;
    // Range on the (tbl, key) primary key: reads only the matching rows across the native bridge.
    const rows =
      prefix === undefined
        ? await this.db.query<{ key: string; value: string }>('SELECT key, value FROM kv WHERE tbl = ? ORDER BY key', [table])
        : await this.db.query<{ key: string; value: string }>('SELECT key, value FROM kv WHERE tbl = ? AND key >= ? AND key < ? ORDER BY key', [table, prefix, prefixEnd(prefix)]);
    return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value) as T }));
  }

  async commit(writes: KvWrite[]): Promise<void> {
    await this.ready;
    if (writes.length === 0) return;
    await this.db.executeSet(
      writes.map((w) =>
        w.value === null
          ? { statement: 'DELETE FROM kv WHERE tbl = ? AND key = ?', values: [w.table, w.key] }
          : { statement: 'INSERT OR REPLACE INTO kv (tbl, key, value) VALUES (?, ?, ?)', values: [w.table, w.key, JSON.stringify(w.value)] },
      ),
    );
  }
}
