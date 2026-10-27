/** Fixed-window in-memory rate limiter. Adequate for a single-process deployment. */
export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  /** Returns true if the action is allowed (and records it). */
  hit(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.buckets.size > 10_000) this.sweep(now);
      return true;
    }
    bucket.count++;
    return bucket.count <= this.limit;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(now: number) {
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
  }
}
