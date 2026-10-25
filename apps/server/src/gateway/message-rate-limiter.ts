export type RateLimit = { burst: number; perSecond: number };

export class MessageRateLimiter {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly clock: () => number,
    private readonly limit: RateLimit,
  ) {
    this.tokens = limit.burst;
    this.updatedAt = clock();
  }

  take(): boolean {
    const now = this.clock();
    this.tokens = Math.min(this.limit.burst, this.tokens + ((now - this.updatedAt) / 1000) * this.limit.perSecond);
    this.updatedAt = now;
    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }
}
