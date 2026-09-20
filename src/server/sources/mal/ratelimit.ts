/**
 * Token bucket.
 *
 * The MAL agreement publishes no rate limit (§6 simply reserves the right to
 * throttle, charge, or restrict at any time) and §4(j) asks us not to place
 * an unreasonable burden on their servers. With no documented quota the only
 * safe posture is a conservative self-imposed one.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number = Math.max(1, Math.ceil(ratePerSecond)),
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {
    if (ratePerSecond <= 0) throw new Error("ratePerSecond must be > 0");
    this.tokens = this.burst;
    this.lastRefill = this.now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = (t - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSecond);
    this.lastRefill = t;
  }

  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      await this.sleep(Math.ceil((deficit / this.ratePerSecond) * 1000));
    }
  }
}
