export class DeviceAudioBudget {
  private readonly used = new Map<string, number>();

  constructor(private readonly maxBytesPerDevice: number) {}

  reserve(deviceId: string, bytes: number): boolean {
    const current = this.used.get(deviceId) ?? 0;
    if (current + bytes > this.maxBytesPerDevice) {
      return false;
    }
    this.used.set(deviceId, current + bytes);
    return true;
  }

  release(deviceId: string, bytes: number): void {
    const next = (this.used.get(deviceId) ?? 0) - bytes;
    if (next <= 0) {
      this.used.delete(deviceId);
      return;
    }
    this.used.set(deviceId, next);
  }
}
