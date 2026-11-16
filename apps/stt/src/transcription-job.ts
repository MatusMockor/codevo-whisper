import type { RoutedTranscript, SupportedLanguage } from '@codevo-whisper/language-routing';
import type { LanguageRouter } from './language-router';
import type { PlainQuery, RoutedQuery } from './transcribe-query';
import type { Transcriber } from './transcriber';

export type PlainReply = { text: string };

export type DirectReply = { text: string; language: SupportedLanguage | null; route: 'direct' };

export type TranscriptionReply = PlainReply | RoutedTranscript | DirectReply;

export interface TranscriptionJob {
  run(pcm: Uint8Array, signal: AbortSignal): Promise<TranscriptionReply>;
}

export class PlainJob implements TranscriptionJob {
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

export class RoutedJob implements TranscriptionJob {
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

export class DirectJob implements TranscriptionJob {
  constructor(
    private readonly transcriber: Transcriber,
    private readonly query: RoutedQuery,
  ) {}

  async run(pcm: Uint8Array, signal: AbortSignal): Promise<DirectReply> {
    const { selection, vocabulary } = this.query;
    const language = selection.size === 1 ? selection.primary() : null;
    const text = await this.transcriber.transcribe({ pcm, language: language ?? 'auto', vocabulary, signal });
    return { text, language, route: 'direct' };
  }
}
