import { RollingSession, SegmentFailedError, type Clock, type SegmentConfig, type TranscriptEvent, type TranscriptionDispatcher } from '@codevo-whisper/audio';
import type { LocalContext } from './transcribe-cli-transcriber';
import { TranscriptionFailedError, type DictationOptions, type EngineDictation, type TranscriptUpdate } from './transcription-engine';

export type { LocalContext } from './transcribe-cli-transcriber';

export const LOCAL_DEVICE_ID = 'local';

export type LocalDictationDeps = {
  dispatcher: TranscriptionDispatcher<LocalContext>;
  clock: Clock;
  context: LocalContext;
  options: DictationOptions;
  segment?: Partial<SegmentConfig>;
};

type State = 'recording' | 'finishing' | 'cancelled';

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
    options.signal.addEventListener('abort', () => this.cancel(), { once: true });
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
    try {
      return await this.session.finish();
    } catch (error) {
      throw this.failure(error);
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
    if (this.state === 'cancelled') {
      return;
    }
    this.state = 'cancelled';
    this.session.cancel();
  }
}
