/** Tiny observable list with a fixed capacity (ring buffer) for logs and the bridge inspector. */
export class RingLog<T> {
  private items: T[] = [];
  private subs = new Set<(items: readonly T[]) => void>();
  constructor(private readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    for (const s of this.subs) s(this.items);
  }

  all(): readonly T[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
    for (const s of this.subs) s(this.items);
  }

  /** Svelte store contract: calls fn immediately and on every change. */
  subscribe(fn: (items: readonly T[]) => void): () => void {
    this.subs.add(fn);
    fn(this.items);
    return () => this.subs.delete(fn);
  }
}
