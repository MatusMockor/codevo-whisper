export class ServiceTimeEstimator {
  private estimate: number | undefined;

  constructor(private readonly alpha = 0.3) {}

  get valueMs(): number | undefined {
    return this.estimate;
  }

  record(ms: number): void {
    if (this.estimate === undefined) {
      this.estimate = ms;
      return;
    }
    this.estimate += this.alpha * (ms - this.estimate);
  }
}
