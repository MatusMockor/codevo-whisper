export class ServiceTimeEstimator {
  private estimate: number | undefined;

  constructor(
    private readonly alpha = 0.3,
    private readonly maxSampleMs = 10_000,
  ) {}

  get valueMs(): number | undefined {
    return this.estimate;
  }

  record(ms: number): void {
    const sample = Math.min(this.maxSampleMs, Math.max(0, Number.isFinite(ms) ? ms : this.maxSampleMs));
    if (this.estimate === undefined) {
      this.estimate = sample;
      return;
    }
    this.estimate += this.alpha * (sample - this.estimate);
  }
}
