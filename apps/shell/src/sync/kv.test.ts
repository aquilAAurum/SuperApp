import { describe, expect, it } from 'vitest';
import { MemoryKv, prefixEnd, type KvBackend, type KvWrite, type Table } from './kv.ts';
import { SyncStore } from './store.ts';
import { DataService } from './data.ts';

/** Counts backend calls, the way each one is a native round trip on Android (SQLite through the bridge). */
class CountingKv implements KvBackend {
  gets = 0;
  lists: { table: Table; prefix: string | undefined; rows: number }[] = [];
  constructor(readonly inner = new MemoryKv()) {}
  async get<T>(table: Table, key: string) {
    this.gets++;
    return this.inner.get<T>(table, key);
  }
  async list<T>(table: Table, prefix?: string) {
    const rows = await this.inner.list<T>(table, prefix);
    this.lists.push({ table, prefix, rows: rows.length });
    return rows;
  }
  commit(writes: KvWrite[]) {
    return this.inner.commit(writes);
  }
}

const rec = (id: string, version = 1) => ({ id, version, deleted: false, owner: 'u', updated: '2026-01-01' });
const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(15 - p.length, '0')}`);

describe('mirror reads by collection', () => {
  it('prefixEnd bounds exactly the keys that start with the prefix', () => {
    expect(prefixEnd('contacts_people/')).toBe('contacts_people0');
    const keys = ['contacts_people/a', 'contacts_people_x/a', 'contacts_peoplf', 'contacts_people/zzz', 'contacts_people0'];
    expect(keys.filter((k) => k >= 'contacts_people/' && k < prefixEnd('contacts_people/'))).toEqual(['contacts_people/a', 'contacts_people/zzz']);
  });

  it('listEntries reads only its collection, so data.list no longer scales with everything on the phone', async () => {
    const kv = new CountingKv();
    const data = new DataService(new SyncStore(kv), { newRecordId: () => 'x', newOpId: () => 'o', now: () => 0, onLocalChange: () => undefined });
    await data.applyServerRecords('contacts_entities', ids(3000, 'e').map((id) => rec(id)));
    await data.applyServerRecords('contacts_people', ids(40, 'p').map((id) => rec(id)));
    kv.lists.length = 0;
    const res = await data.list('contacts_people', { perPage: 500 });
    expect(res.totalItems).toBe(40);
    expect(kv.lists).toEqual([{ table: 'mirror', prefix: 'contacts_people/', rows: 40 }]);
  });

  it('a large catch-up does one range read, not one lookup per record', async () => {
    const kv = new CountingKv();
    const data = new DataService(new SyncStore(kv), { newRecordId: () => 'x', newOpId: () => 'o', now: () => 0, onLocalChange: () => undefined });
    const changed = await data.applyServerRecords('contacts_edges', ids(2500, 'g').map((id) => rec(id)));
    expect(changed).toHaveLength(2500);
    expect(kv.gets).toBe(0);
    expect(kv.lists).toHaveLength(1);
    // Re-applying the same versions changes nothing (the per-record rules still hold).
    expect(await data.applyServerRecords('contacts_edges', ids(2500, 'g').map((id) => rec(id)))).toEqual([]);
    expect((await data.applyServerRecords('contacts_edges', [rec(ids(1, 'g')[0]!, 2), rec(ids(2, 'g')[1]!, 1)])).length).toBe(1);
  });
});
