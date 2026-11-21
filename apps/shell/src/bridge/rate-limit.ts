/** Token bucket per app (spec §Security: default 50 requests/second). Clock injectable for tests. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; last: number }>();
  constructor(
    private readonly perSecond: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  take(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.perSecond, last: t };
    b.tokens = Math.min(this.perSecond, b.tokens + ((t - b.last) / 1000) * this.perSecond);
    b.last = t;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    return ok;
  }

  forget(key: string): void {
    this.buckets.delete(key);
  }
}
