import { DICTATION_LANGUAGES, MAX_TEXT_CHARS, ProtocolError, type DictationLanguage } from '@codevo-whisper/protocol';
import type { SttRequest, SttTranscript } from './stt-client';

const ROUTES: readonly string[] = ['auto', 'verbatim-short', 'verbatim-foreign', 'verbatim-unsure', 'conditioned-fix', 'verbatim-guard', 'conditioned', 'verbatim-fallback'];

type Reply = { text: string; language?: unknown; route?: unknown };

function unavailable(message: string): ProtocolError {
  return new ProtocolError('stt_unavailable', message);
}

function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && typeof (value as { text?: unknown }).text === 'string';
}

function detectedLanguage(value: unknown): DictationLanguage | null {
  if (value === undefined || value === null) {
    return null;
  }
  const language = DICTATION_LANGUAGES.find((candidate) => candidate === value);
  if (language === undefined) {
    throw unavailable('the STT engine sent an unknown language');
  }
  return language;
}

function routeOf(value: unknown): string | null {
  return ROUTES.find((route) => route === value) ?? null;
}

export function parseSttTranscript(body: unknown, request: SttRequest): SttTranscript {
  if (!isReply(body)) {
    throw unavailable('the STT engine sent no text');
  }
  if ([...body.text].length > MAX_TEXT_CHARS) {
    throw unavailable('the STT engine sent more text than the protocol allows');
  }
  if (request.languages === null) {
    return { text: body.text, language: null, route: null };
  }
  return { text: body.text, language: detectedLanguage(body.language), route: routeOf(body.route) };
}
