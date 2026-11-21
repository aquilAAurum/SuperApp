/**
 * Minimal durable key/value tables with atomic multi-write commits. The sync store is built on this
 * so the same logic runs on SQLite (Android), IndexedDB (browser/E2E) and memory (unit tests).
 * Spec §Integrity: "Local mirror writes and outbox appends happen in one SQLite transaction" →
 * every caller that touches both uses one `commit()`.
 */
export type Table = 'mirror' | 'outbox' | 'meta';
export const TABLES: readonly Table[] = ['mirror', 'outbox', 'meta'];

export interface KvWrite {
  table: Table;
  key: string;
  /** null deletes the key. */
  value: unknown | null;
}

export interface KvBackend {
  get<T>(table: Table, key: string): Promise<T | undefined>;
  /** All entries of a table, ordered by key. */
  list<T>(table: Table): Promise<{ key: string; value: T }[]>;
  /** Applies all writes atomically: either every write lands or none does. */
  commit(writes: KvWrite[]): Promise<void>;
}

export class MemoryKv implements KvBackend {
  private tables = new Map<Table, Map<string, string>>(TABLES.map((t) => [t, new Map()]));
  /** Test hook: make the next commit fail before applying anything (simulates a crash). */
  failNextCommit = false;

  async get<T>(table: Table, key: string): Promise<T | undefined> {
    const v = this.tables.get(table)!.get(key);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }

  async list<T>(table: Table): Promise<{ key: string; value: T }[]> {
    return [...this.tables.get(table)!.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => ({ key, value: JSON.parse(v) as T }));
  }

  async commit(writes: KvWrite[]): Promise<void> {
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error('simulated crash before commit');
    }
    for (const w of writes) {
      const t = this.tables.get(w.table)!;
      if (w.value === null) t.delete(w.key);
      else t.set(w.key, JSON.stringify(w.value));
    }
  }
}

/** Lets the engine start synchronously while the real backend (e.g. encrypted SQLite) opens. */
export class DeferredKv implements KvBackend {
  constructor(private readonly ready: Promise<KvBackend>) {}
  async get<T>(table: Table, key: string): Promise<T | undefined> {
    return (await this.ready).get<T>(table, key);
  }
  async list<T>(table: Table): Promise<{ key: string; value: T }[]> {
    return (await this.ready).list<T>(table);
  }
  async commit(writes: KvWrite[]): Promise<void> {
    return (await this.ready).commit(writes);
  }
}
