import type { SegmentTranscriber } from '../../src/scheduling/segment-transcriber';

export type PendingCall = {
  pcm: Uint8Array;
  signal: AbortSignal;
  resolve: (text: string) => void;
  reject: (error: unknown) => void;
};

export class ControllableTranscriber implements SegmentTranscriber {
  readonly calls: PendingCall[] = [];

  transcribe(pcm: Uint8Array, signal: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      this.calls.push({ pcm, signal, resolve, reject });
    });
  }

  call(index: number): PendingCall {
    const call = this.calls[index];
    if (call === undefined) {
      return { pcm: new Uint8Array(0), signal: AbortSignal.abort(), resolve: () => undefined, reject: () => undefined };
    }
    return call;
  }
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
