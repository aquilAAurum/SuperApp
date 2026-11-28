// Loads every contacts_* collection from the shell's local mirror and keeps it current.
//
// Built for a real vault (~8,000 records) on a phone, where each data.list call goes through the
// encrypted SQLite mirror over the native bridge and can take seconds:
// - collections load one at a time (parallel calls queued behind each other and hit the 15 s
//   request timeout, which left the app silently empty on the first real device run);
// - each call gets a long timeout and timeouts are retried;
// - the raw bridge subscription is used as a change signal only (the SDK's data.subscribe helper
//   re-lists 500 rows on every change, which doubled the work during the first download);
// - progress and failures are reported, so the screen never claims "no contacts" while loading.
import { BridgeError, type SuperApp } from '@superapp/sdk';
import { COLLECTIONS, emptyRaw, type CollectionKey, type Raw } from './model.ts';

const PAGE = 500;
export const CALL_TIMEOUT_MS = 120_000;
const RETRIES = 3;

export type LoadState = { phase: 'loading'; done: number; total: number } | { phase: 'ready' } | { phase: 'error'; message: string };

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof BridgeError && (err.code === 'TIMEOUT' || err.code === 'RATE_LIMITED');
      if (!retryable || attempt >= RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

export async function listAll<T>(sa: SuperApp, collection: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const res = await withRetry(() => sa.call<{ items: T[] }>('data.list', { collection, page, perPage: PAGE }, { timeoutMs: CALL_TIMEOUT_MS }));
    out.push(...res.items);
    if (res.items.length < PAGE) return out;
  }
}

export interface Watch {
  stop(): void;
  /** Reload everything now (the error screen's Retry). */
  reloadAll(): void;
}

/**
 * Calls `onChange(raw)` after the first full load and again (debounced) after changes; `onState`
 * reports loading progress and failures.
 */
export async function watchAll(sa: SuperApp, onChange: (raw: Raw) => void, onState: (s: LoadState) => void, debounceMs = 300): Promise<Watch> {
  const raw = emptyRaw();
  const keys = Object.keys(COLLECTIONS) as CollectionKey[];
  const byCollection = new Map(keys.map((k) => [COLLECTIONS[k] as string, k]));
  const dirty = new Set<CollectionKey>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let ready = false;

  const reload = async (which: CollectionKey[], report: boolean) => {
    let done = 0;
    for (const k of which) {
      if (report) onState({ phase: 'loading', done, total: which.length });
      (raw as unknown as Record<string, unknown[]>)[k] = await listAll(sa, COLLECTIONS[k]);
      done++;
    }
    onChange({ ...raw });
  };
  const run = (which: CollectionKey[], report: boolean) => {
    chain = chain
      .then(() => reload(which, report))
      .then(() => {
        ready = true;
        onState({ phase: 'ready' });
      })
      .catch((err: Error) => {
        const code = err instanceof BridgeError ? err.code : 'UNKNOWN';
        void sa.sys.log('warn', 'contacts.reload_failed', { code, error: err.message }).catch(() => undefined);
        if (!ready) onState({ phase: 'error', message: `${code}: ${err.message}` });
      });
  };
  const offChanged = sa.on('data.changed', (p) => {
    const k = byCollection.get(String((p as { collection?: unknown }).collection));
    if (!k) return;
    dirty.add(k);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const which = keys.filter((x) => dirty.has(x));
      dirty.clear();
      run(which, false);
    }, debounceMs);
  });

  // Subscribing makes the shell track each collection and catch up from the server in the background.
  const subs: string[] = [];
  for (const k of keys) {
    const r = await withRetry(() => sa.call<{ subscriptionId: string }>('data.subscribe', { collection: COLLECTIONS[k] }, { timeoutMs: CALL_TIMEOUT_MS }));
    subs.push(r.subscriptionId);
  }
  run(keys, true);
  return {
    stop: () => {
      if (timer) clearTimeout(timer);
      offChanged();
      for (const id of subs) void sa.call('data.unsubscribe', { subscriptionId: id }).catch(() => undefined);
    },
    reloadAll: () => {
      onState({ phase: 'loading', done: 0, total: keys.length });
      run(keys, true);
    },
  };
}
