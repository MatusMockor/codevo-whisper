export class ActivityGate {
  private running = 0;

  begin(): () => void {
    this.running += 1;
    let ended = false;
    return () => {
      if (ended) {
        return;
      }
      ended = true;
      this.running -= 1;
    };
  }

  get active(): boolean {
    return this.running > 0;
  }
}

export const HOTKEY_RECORDING = new ActivityGate();
