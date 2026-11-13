const FAILED_RECORDING_MS = 10 * 60_000;

export class FailedRecording {
  private pcm: Uint8Array | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly released = new WeakSet<Uint8Array>();

  get(): Uint8Array | null {
    return this.pcm;
  }

  keep(pcm: Uint8Array): boolean {
    if (this.pcm === pcm) return true;
    if (this.released.has(pcm)) return false;
    this.drop();
    this.pcm = pcm;
    this.timer = setTimeout(() => this.drop(), FAILED_RECORDING_MS);
    this.timer.unref();
    this.changed();
    return true;
  }

  forget(pcm: Uint8Array): void {
    if (this.pcm === pcm) this.drop();
  }

  drop(): void {
    if (this.pcm === null) return;
    this.clearTimer();
    this.released.add(this.pcm);
    this.pcm = null;
    this.changed();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
