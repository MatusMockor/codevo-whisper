export type BucketLimits = { capacity: number; perSecond: number };

type Bucket = { tokens: number; updatedAt: number };

export class KeyedTokenBucket {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly clock: () => number,
    private readonly limits: BucketLimits,
  ) {}

  take(key: string, amount = 1): boolean {
    const available = this.available(key);
    if (amount > available) {
      return false;
    }
    this.buckets.set(key, { tokens: available - amount, updatedAt: this.clock() });
    return true;
  }

  available(key: string): number {
    const bucket = this.buckets.get(key);
    if (bucket === undefined) {
      return this.limits.capacity;
    }
    const refilled = bucket.tokens + (Math.max(0, this.clock() - bucket.updatedAt) / 1000) * this.limits.perSecond;
    if (refilled >= this.limits.capacity) {
      this.buckets.delete(key);
      return this.limits.capacity;
    }
    return refilled;
  }
}
