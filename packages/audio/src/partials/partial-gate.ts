export class PartialGate {
  private lastRequestAt: number;

  constructor(
    startedAt: number,
    private readonly minTailMs: number,
  ) {
    this.lastRequestAt = startedAt;
  }

  isDue(now: number, intervalMs: number, tailMs: number, voicedSinceRequest: boolean): boolean {
    return now - this.lastRequestAt >= intervalMs && tailMs >= this.minTailMs && voicedSinceRequest;
  }

  markRequested(now: number): void {
    this.lastRequestAt = now;
  }
}
