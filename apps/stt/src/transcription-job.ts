import type { RoutedTranscript } from '@codevo-whisper/language-routing';
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
    private readonly query: PlainQuery,
  ) {}

  async run(pcm: Uint8Array, signal: AbortSignal): Promise<PlainReply> {
    const { language, vocabulary } = this.query;
    const text = await this.transcriber.transcribe({ pcm, language, vocabulary, signal });
    return { text };
  }
}

class RoutedJob implements TranscriptionJob {
  constructor(
    private readonly router: LanguageRouter,
    private readonly query: RoutedQuery,
  ) {}

  async run(pcm: Uint8Array, signal: AbortSignal): Promise<RoutedTranscript> {
    const { selection, segment, vocabulary } = this.query;
    const { text, language, route } = await this.router.transcribe({ pcm, selection, kind: segment, signal }, vocabulary);
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
      return new PlainJob(this.transcriber, query);
    }
    if (this.router.languages().length === 0) {
      return null;
    }
    return new RoutedJob(this.router, query);
  }
}
