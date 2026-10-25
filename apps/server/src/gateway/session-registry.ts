import type { ErrorCode } from '@codevo-whisper/protocol';

type Entry = { deviceId: string; close: (code: ErrorCode) => void };

export class SessionRegistry {
  private readonly entries = new Set<Entry>();

  add(deviceId: string, close: (code: ErrorCode) => void): () => void {
    const entry: Entry = { deviceId, close };
    this.entries.add(entry);
    return () => {
      this.entries.delete(entry);
    };
  }

  closeDevice(deviceId: string, code: ErrorCode): number {
    return this.closeMatching((entry) => entry.deviceId === deviceId, code);
  }

  closeAll(code: ErrorCode): number {
    return this.closeMatching(() => true, code);
  }

  count(): number {
    return this.entries.size;
  }

  private closeMatching(predicate: (entry: Entry) => boolean, code: ErrorCode): number {
    const matching = [...this.entries].filter(predicate);
    matching.forEach((entry) => {
      this.entries.delete(entry);
      entry.close(code);
    });
    return matching.length;
  }
}
