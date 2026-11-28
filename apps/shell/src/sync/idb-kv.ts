import { TABLES, prefixEnd, type KvBackend, type KvWrite, type Table } from './kv.ts';

/**
 * IndexedDB backend for the browser build (dev and E2E). Not used on Android, where the
 * CapabilityBroker provides encrypted SQLite. One IDB transaction per commit = atomic.
 */
export class IndexedDbKv implements KvBackend {
  private dbp: Promise<IDBDatabase>;

  constructor(name = 'superapp-sync') {
    this.dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        for (const t of TABLES) if (!req.result.objectStoreNames.contains(t)) req.result.createObjectStore(t);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async tx(tables: Table[], mode: IDBTransactionMode): Promise<IDBTransaction> {
    return (await this.dbp).transaction(tables, mode);
  }

  async get<T>(table: Table, key: string): Promise<T | undefined> {
    const t = await this.tx([table], 'readonly');
    return new Promise((resolve, reject) => {
      const r = t.objectStore(table).get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => reject(r.error);
    });
  }

  async list<T>(table: Table, prefix?: string): Promise<{ key: string; value: T }[]> {
    const t = await this.tx([table], 'readonly');
    const store = t.objectStore(table);
    const range = prefix === undefined ? undefined : IDBKeyRange.bound(prefix, prefixEnd(prefix), false, true);
    const [keys, values] = await Promise.all([
      new Promise<IDBValidKey[]>((res, rej) => {
        const r = store.getAllKeys(range);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }),
      new Promise<T[]>((res, rej) => {
        const r = store.getAll(range);
        r.onsuccess = () => res(r.result as T[]);
        r.onerror = () => rej(r.error);
      }),
    ]);
    return keys.map((k, i) => ({ key: String(k), value: values[i]! }));
  }

  async commit(writes: KvWrite[]): Promise<void> {
    if (writes.length === 0) return;
    const tables = [...new Set(writes.map((w) => w.table))];
    const t = await this.tx(tables, 'readwrite');
    for (const w of writes) {
      const s = t.objectStore(w.table);
      if (w.value === null) s.delete(w.key);
      else s.put(structuredClone(w.value), w.key);
    }
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
    });
  }
}
