import type { LanguageSelection, RoutedTranscript, SegmentKind } from '@codevo-whisper/language-routing';
import type { TranscribeLanguage } from '@codevo-whisper/stt-runner';
import type { LanguageRouter } from './language-router';
import type { PlainQuery, RoutedQuery } from './transcribe-query';
import type { Transcriber } from './transcriber';

export type PlainReply = { text: string };

export type TranscriptionReply = PlainReply | RoutedTranscript;

export interface TranscriptionJob {
  run(pcm: Uint8Array, signal: AbortSignal): Promise<TranscriptionReply>;
}

class PlainJob implements TranscriptionJob {
  constructor(
    private readonly transcriber: Transcriber,
    private readonly language: TranscribeLanguage,
  ) {}

  async run(pcm: Uint8Array, signal: AbortSignal): Promise<PlainReply> {
    const text = await this.transcriber.transcribe({ pcm, language: this.language, signal });
    return { text };
  }
}

class RoutedJob implements TranscriptionJob {
  constructor(
    private readonly router: LanguageRouter,
    private readonly selection: LanguageSelection,
    private readonly segment: SegmentKind,
  ) {}

  async run(pcm: Uint8Array, signal: AbortSignal): Promise<RoutedTranscript> {
    const { text, language, route } = await this.router.transcribe({ pcm, selection: this.selection, kind: this.segment, signal });
    return { text, language, route };
  }
}

export class TranscriptionJobs {
  constructor(
    private readonly transcriber: Transcriber,
    private readonly router: LanguageRouter,
  ) {}

  for(query: PlainQuery | RoutedQuery): TranscriptionJob | null {
    if (query.kind === 'plain') {
      return new PlainJob(this.transcriber, query.language);
    }
    if (this.router.languages().length === 0) {
      return null;
    }
    return new RoutedJob(this.router, query.selection, query.segment);
  }
}
