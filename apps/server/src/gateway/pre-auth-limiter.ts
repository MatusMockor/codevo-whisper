export type PreAuthLimits = { maxPendingTotal: number; maxPendingPerIp: number; maxConnectionsPerIp: number };

function decrement(counts: Map<string, number>, ip: string): void {
  const next = (counts.get(ip) ?? 0) - 1;
  if (next <= 0) {
    counts.delete(ip);
    return;
  }
  counts.set(ip, next);
}

export class PreAuthLimiter {
  private readonly pendingByIp = new Map<string, number>();
  private readonly connectionsByIp = new Map<string, number>();
  private pendingTotal = 0;

  constructor(private readonly limits: PreAuthLimits) {}

  tryAcquire(ip: string): boolean {
    const pending = this.pendingByIp.get(ip) ?? 0;
    const connections = this.connectionsByIp.get(ip) ?? 0;
    if (this.pendingTotal >= this.limits.maxPendingTotal || pending >= this.limits.maxPendingPerIp) {
      return false;
    }
    if (connections >= this.limits.maxConnectionsPerIp) {
      return false;
    }
    this.pendingTotal += 1;
    this.pendingByIp.set(ip, pending + 1);
    this.connectionsByIp.set(ip, connections + 1);
    return true;
  }

  promote(ip: string): void {
    this.pendingTotal -= 1;
    decrement(this.pendingByIp, ip);
  }

  release(ip: string, authenticated: boolean): void {
    if (!authenticated) {
      this.promote(ip);
    }
    decrement(this.connectionsByIp, ip);
  }

  pending(): number {
    return this.pendingTotal;
  }
}
