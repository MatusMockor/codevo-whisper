import { RollingSession } from '../../src/session/rolling-session';
import type { RollingSessionOptions } from '../../src/session/rolling-session-options';
import type { SegmentTranscriber } from '../../src/scheduling/segment-transcriber';
import { TranscriptionDispatcher } from '../../src/scheduling/transcription-dispatcher';
import type { TranscriptEvent } from '../../src/transcript/transcript-event';
import { flush } from './controllable-transcriber';
import { toBytes } from './fixtures';
import { ManualClock } from './manual-clock';

export const CHUNK_SAMPLES = 1600;
export const CHUNK_MS = 100;

export type Harness = {
  clock: ManualClock;
  dispatcher: TranscriptionDispatcher;
  open: (deviceId: string, partials: boolean, extra?: Partial<RollingSessionOptions>) => { session: RollingSession; events: TranscriptEvent[] };
};

export function harness(transcriber: SegmentTranscriber): Harness {
  const clock = new ManualClock();
  const dispatcher = new TranscriptionDispatcher({ transcriber, clock });
  return {
    clock,
    dispatcher,
    open: (deviceId, partials, extra = {}) => {
      const events: TranscriptEvent[] = [];
      const session = new RollingSession({
        deviceId,
        partials,
        submitter: dispatcher,
        registry: dispatcher,
        interval: dispatcher.partialIntervalSource(),
        clock,
        onEvent: (event) => events.push(event),
        ...extra,
      });
      return { session, events };
    },
  };
}

export async function feed(clock: ManualClock, sessions: RollingSession[], samples: Int16Array, fromSample = 0, toSample = samples.length): Promise<void> {
  for (let start = fromSample; start < toSample; start += CHUNK_SAMPLES) {
    clock.advance(CHUNK_MS);
    const chunk = toBytes(samples.subarray(start, Math.min(toSample, start + CHUNK_SAMPLES)));
    sessions.forEach((session) => session.push(chunk));
    await flush();
  }
}
