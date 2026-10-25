import { assert } from 'vitest';
import type { SegmentTranscriber } from '../../src/scheduling/segment-transcriber';
import type { TranscriptionJob } from '../../src/scheduling/transcription-job';

export type PendingCall = {
  job: TranscriptionJob;
  pcm: Uint8Array;
  signal: AbortSignal;
  resolve: (text: string) => void;
  reject: (error: unknown) => void;
};

export class ControllableTranscriber implements SegmentTranscriber {
  readonly calls: PendingCall[] = [];

  transcribe(job: TranscriptionJob, signal: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      this.calls.push({ job, pcm: job.pcm, signal, resolve, reject });
    });
  }

  call(index: number): PendingCall {
    const call = this.calls[index];
    assert.isDefined(call, `engine call ${index} was never made`);
    return call;
  }
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
