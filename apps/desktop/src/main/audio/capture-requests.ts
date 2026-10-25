import type { CaptureReply } from '../../shared/capture-contract';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export class CaptureRequests {
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  create(timeoutMs: number): { id: number; promise: Promise<unknown> } {
    const id = this.nextId;
    this.nextId += 1;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.take(id)?.reject(new Error(`Capture request ${id} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    return { id, promise };
  }

  settle(reply: CaptureReply): boolean {
    const pending = this.take(reply.id);
    if (pending === undefined) {
      return false;
    }
    if (reply.ok) {
      pending.resolve(reply.value);
      return true;
    }
    pending.reject(new Error(reply.error));
    return true;
  }

  rejectAll(error: Error): void {
    for (const id of [...this.pending.keys()]) {
      this.take(id)?.reject(error);
    }
  }

  private take(id: number): Pending | undefined {
    const pending = this.pending.get(id);
    if (pending === undefined) {
      return undefined;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    return pending;
  }
}
