/** Minimal writable store (Svelte store contract) usable from plain TS modules. */
export interface Writable<T> {
  subscribe(fn: (v: T) => void): () => void;
  set(v: T): void;
  update(fn: (v: T) => T): void;
  get(): T;
}

export function writable<T>(initial: T): Writable<T> {
  let value = initial;
  const subs = new Set<(v: T) => void>();
  return {
    subscribe(fn) {
      subs.add(fn);
      fn(value);
      return () => subs.delete(fn);
    },
    set(v) {
      value = v;
      for (const s of subs) s(value);
    },
    update(fn) {
      this.set(fn(value));
    },
    get: () => value,
  };
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

let nextToast = 1;
export const toasts = writable<Toast[]>([]);

/** Non-blocking feedback (CORE-24). Never use alert/confirm/prompt. */
export function showToast(text: string, kind: Toast['kind'] = 'info', ms = 4000): void {
  const t = { id: nextToast++, text, kind };
  toasts.update((all) => [...all, t]);
  setTimeout(() => toasts.update((all) => all.filter((x) => x.id !== t.id)), ms);
}
