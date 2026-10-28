import { RollingSession, SegmentFailedError, type Clock, type SegmentConfig, type TranscriptEvent, type TranscriptionDispatcher } from '@codevo-whisper/audio';
import type { LocalContext } from './resident-segment-transcriber';
import { TranscriptionFailedError, type DictationOptions, type EngineDictation, type TranscriptUpdate } from './transcription-engine';

export type { LocalContext } from './resident-segment-transcriber';

export const LOCAL_DEVICE_ID = 'local';

export type LocalDictationDeps = {
  dispatcher: TranscriptionDispatcher<LocalContext>;
  clock: Clock;
  context: LocalContext;
  options: DictationOptions;
  segment?: Partial<SegmentConfig>;
  onRecordingEnd?: () => void;
  onTerminal?: () => void;
};

type State = 'recording' | 'finishing' | 'cancelled' | 'finished';

function abortError(): DOMException {
  return new DOMException('The dictation was cancelled', 'AbortError');
}

function toUpdate(event: TranscriptEvent): TranscriptUpdate {
  if (event.type === 'partial') {
    return { type: 'partial', segmentId: event.segmentId, revision: event.revision, text: event.text };
  }
  return { type: 'final', segmentId: event.segmentId, text: event.text };
}

export class LocalDictation implements EngineDictation {
  private readonly session: RollingSession<LocalContext>;
  private state: State = 'recording';
  private released = false;
  private readonly onAbort = () => this.cancel();

  constructor(private readonly deps: LocalDictationDeps) {
    const { dispatcher, options } = deps;
    this.session = new RollingSession<LocalContext>({
      deviceId: LOCAL_DEVICE_ID,
      partials: options.partials === true,
      context: deps.context,
      submitter: dispatcher,
      registry: dispatcher,
      interval: dispatcher.partialIntervalSource(),
      clock: deps.clock,
      onEvent: (event) => options.onTranscript?.(toUpdate(event)),
      ...(deps.segment === undefined ? {} : { segment: deps.segment }),
    });
    if (options.signal.aborted) {
      this.cancel();
      return;
    }
    options.signal.addEventListener('abort', this.onAbort, { once: true });
  }

  push(pcm: Uint8Array): void {
    if (this.state !== 'recording') {
      return;
    }
    this.session.push(pcm);
  }

  async finish(): Promise<string> {
    if (this.state !== 'recording') {
      throw abortError();
    }
    this.state = 'finishing';
    this.deps.onRecordingEnd?.();
    try {
      return await this.session.finish();
    } catch (error) {
      throw this.failure(error);
    } finally {
      this.state = 'finished';
      this.release();
    }
  }

  private failure(error: unknown): Error {
    if (this.deps.options.signal.aborted) {
      return abortError();
    }
    if (error instanceof SegmentFailedError) {
      return new TranscriptionFailedError('engine-failed', error.textSoFar, { cause: error });
    }
    return new TranscriptionFailedError('engine-failed', '', { cause: error });
  }

  private cancel(): void {
    if (this.state === 'cancelled' || this.state === 'finished') {
      return;
    }
    if (this.state === 'recording') this.deps.onRecordingEnd?.();
    this.state = 'cancelled';
    this.session.cancel();
    this.release();
  }

  private release(): void {
    if (this.released) return;
    this.released = true;
    this.deps.options.signal.removeEventListener('abort', this.onAbort);
    this.deps.onTerminal?.();
  }
}
