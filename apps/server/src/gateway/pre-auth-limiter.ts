export type PreAuthLimits = { maxPendingTotal: number; maxPendingPerIp: number };

export class PreAuthLimiter {
  private readonly pendingByIp = new Map<string, number>();
  private pendingTotal = 0;

  constructor(private readonly limits: PreAuthLimits) {}

  tryAcquire(ip: string): boolean {
    const pending = this.pendingByIp.get(ip) ?? 0;
    if (this.pendingTotal >= this.limits.maxPendingTotal || pending >= this.limits.maxPendingPerIp) {
      return false;
    }
    this.pendingTotal += 1;
    this.pendingByIp.set(ip, pending + 1);
    return true;
  }

  promote(ip: string): void {
    this.pendingTotal -= 1;
    const next = (this.pendingByIp.get(ip) ?? 0) - 1;
    if (next <= 0) {
      this.pendingByIp.delete(ip);
      return;
    }
    this.pendingByIp.set(ip, next);
  }

  release(ip: string, authenticated: boolean): void {
    if (!authenticated) {
      this.promote(ip);
    }
  }

  pending(): number {
    return this.pendingTotal;
  }
}
