import type { VadFrame } from '../../src/vad/vad-frame';

export type Run = { startMs: number; durationMs: number };

export function unvoicedRuns(frames: VadFrame[], minMs: number, isQuiet: (frame: VadFrame) => boolean = (frame) => !frame.voiced): Run[] {
  const runs: Run[] = [];
  let start: VadFrame | undefined;
  let last: VadFrame | undefined;
  const close = (): void => {
    if (start === undefined || last === undefined) {
      return;
    }
    const durationMs = ((last.endSample - start.startSample) * 1000) / 16000;
    if (durationMs >= minMs) {
      runs.push({ startMs: (start.startSample * 1000) / 16000, durationMs });
    }
    start = undefined;
  };
  for (const frame of frames) {
    if (!isQuiet(frame)) {
      close();
      continue;
    }
    start ??= frame;
    last = frame;
  }
  close();
  return runs;
}
