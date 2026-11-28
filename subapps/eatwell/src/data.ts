// Loads every eatwell_* collection from the shell's local mirror and keeps it current. The
// subscription is a change signal only; each change reloads that collection page by page through
// data.list (answered locally by the mirror), so diaries longer than the 500-row window still load.
import type { SuperApp } from '@superapp/sdk';
import { COLLECTIONS, emptyRaw, type CollectionKey, type Raw } from './model.ts';

const PAGE = 500;

export async function listAll<T>(sa: SuperApp, collection: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const res = await sa.data.list<T>(collection, { page, perPage: PAGE });
    out.push(...res.items);
    if (res.items.length < PAGE) return out;
  }
}

export async function watchAll(sa: SuperApp, onChange: (raw: Raw) => void, debounceMs = 80): Promise<() => void> {
  const raw = emptyRaw();
  const keys = Object.keys(COLLECTIONS) as CollectionKey[];
  const dirty = new Set<CollectionKey>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loading: Promise<void> = Promise.resolve();
  let started = false;

  const reload = async (which: CollectionKey[]) => {
    const results = await Promise.all(which.map((k) => listAll(sa, COLLECTIONS[k])));
    which.forEach((k, i) => ((raw as unknown as Record<string, unknown[]>)[k] = results[i]!));
    onChange({ ...raw });
  };
  const flush = () => {
    timer = null;
    const which = [...dirty];
    dirty.clear();
    loading = loading.then(() => reload(which)).catch((err: Error) => void sa.sys.log('warn', 'eatwell.reload_failed', { error: err.message }));
  };

  const offs = await Promise.all(
    keys.map((k) =>
      sa.data.subscribe(
        COLLECTIONS[k],
        () => {
          if (!started) return;
          dirty.add(k);
          if (timer) clearTimeout(timer);
          timer = setTimeout(flush, debounceMs);
        },
        {},
      ),
    ),
  );
  started = true;
  await reload(keys);
  return () => {
    if (timer) clearTimeout(timer);
    for (const off of offs) off();
  };
}
