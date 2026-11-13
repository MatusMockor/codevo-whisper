import { RollingSession, SegmentFailedError, SessionCancelledError, type TranscriptEvent } from '@codevo-whisper/audio';
import { ProtocolError, type DictationLanguage, type ErrorCode, type Language } from '@codevo-whisper/protocol';
import type { GatewayContext, GatewayDispatcher } from '../stt/gateway-context';
import { limitText } from './limit-text';
import { SegmentTranscripts } from './segment-transcripts';
import type { SecureChannel } from './secure-channel';

export type DictationOptions = {
  sessionId: string;
  deviceId: string;
  language: Language;
  languages: readonly DictationLanguage[] | null;
  vocabulary: readonly string[];
  partials: boolean;
  dispatcher: GatewayDispatcher;
  clock: () => number;
  channel: SecureChannel;
};

export type DictationResult = 'ok' | 'cancelled' | ErrorCode;

export type DictationCounts = { audioBytes: number; finals: number; partials: number };

export type DictationStats = DictationCounts & { routes: Readonly<Record<string, number>> };

type DetectedLanguage = { language?: DictationLanguage | null };

function errorCodeOf(error: unknown): ErrorCode {
  const cause = error instanceof SegmentFailedError ? error.cause : error;
  if (cause instanceof ProtocolError) {
    return cause.code;
  }
  return 'stt_unavailable';
}

export class Dictation {
  private readonly session: RollingSession<GatewayContext>;
  private readonly counts: DictationCounts = { audioBytes: 0, finals: 0, partials: 0 };
  private readonly transcripts = new SegmentTranscripts();

  constructor(private readonly options: DictationOptions) {
    this.session = new RollingSession({
      deviceId: options.deviceId,
      partials: options.partials,
      context: { language: options.language, languages: options.languages, vocabulary: options.vocabulary, observer: this.transcripts },
      submitter: options.dispatcher,
      registry: options.dispatcher,
      interval: options.dispatcher.partialIntervalSource(),
      clock: { now: options.clock },
      onEvent: (event) => this.forward(event),
    });
  }

  get sessionId(): string {
    return this.options.sessionId;
  }

  get audioBytes(): number {
    return this.counts.audioBytes;
  }

  stats(): DictationStats {
    return { ...this.counts, routes: this.transcripts.routes() };
  }

  push(pcm: Uint8Array): void {
    this.counts.audioBytes += pcm.length;
    this.session.push(pcm);
  }

  async finish(): Promise<DictationResult> {
    try {
      await this.session.finish();
      this.options.channel.send({ type: 'done', sessionId: this.sessionId });
      return 'ok';
    } catch (error) {
      if (error instanceof SessionCancelledError) {
        return 'cancelled';
      }
      const code = errorCodeOf(error);
      this.options.channel.send({ type: 'error', code, message: code, sessionId: this.sessionId });
      return code;
    }
  }

  cancel(): void {
    this.session.cancel();
  }

  private forward(event: TranscriptEvent): void {
    const text = limitText(event.text);
    const detected = this.detectedLanguage(event);
    if (event.type === 'partial') {
      this.counts.partials += 1;
      this.options.channel.send({ type: 'partial', sessionId: this.sessionId, segmentId: event.segmentId, revision: event.revision, text, ...detected });
      return;
    }
    this.counts.finals += 1;
    this.options.channel.send({ type: 'final', sessionId: this.sessionId, segmentId: event.segmentId, text, ...detected });
  }

  private detectedLanguage(event: TranscriptEvent): DetectedLanguage {
    const language = this.transcripts.languageOf(event);
    if (this.options.languages === null) {
      return {};
    }
    return { language };
  }
}
