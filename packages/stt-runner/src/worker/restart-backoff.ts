export type BackoffOptions = { initialMs: number; maxMs: number };

export class RestartBackoff {
  private failures = 0;

  constructor(private readonly options: BackoffOptions) {}

  delayMs(): number {
    if (this.failures === 0) {
      return 0;
    }
    return Math.min(this.options.maxMs, this.options.initialMs * 2 ** (this.failures - 1));
  }

  recordFailure(): void {
    this.failures += 1;
  }

  reset(): void {
    this.failures = 0;
  }
}
