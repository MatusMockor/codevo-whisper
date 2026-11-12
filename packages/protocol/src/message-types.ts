import type { ErrorCode } from './errors';
import type { ServerModels } from './server-models';

export const LANGUAGES = ['sk', 'en', 'cs', 'auto'] as const;

export type Language = (typeof LANGUAGES)[number];

export const DICTATION_LANGUAGES = [
  'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'it',
  'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'uk',
] as const;

export type DictationLanguage = (typeof DICTATION_LANGUAGES)[number];

export const MAX_DICTATION_LANGUAGES = 5;

export enum MessageTag {
  Json = 0x01,
  Audio = 0x02,
}

export const MAX_DEVICE_NAME_CHARS = 64;
export const MAX_IDENTIFIER_CHARS = 64;
export const MAX_TEXT_CHARS = 16000;
export const MAX_ERROR_MESSAGE_CHARS = 512;
export const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]+$/;

export type ClientMessage =
  | { type: 'hello' }
  | { type: 'capabilities' }
  | { type: 'start'; sessionId: string; language: Language; partials?: boolean; languages?: readonly DictationLanguage[] }
  | { type: 'audio'; pcm: Uint8Array }
  | { type: 'finish' }
  | { type: 'cancel' }
  | { type: 'pair-request'; deviceName: string };

export type ServerMessage =
  | { type: 'ready'; serverVersion: string }
  | { type: 'capabilities'; languages: readonly DictationLanguage[]; models: ServerModels }
  | { type: 'partial'; sessionId: string; segmentId: number; revision: number; text: string; language?: DictationLanguage | null }
  | { type: 'final'; sessionId: string; segmentId: number; text: string; language?: DictationLanguage | null }
  | { type: 'done'; sessionId: string }
  | { type: 'flow'; paused: boolean }
  | { type: 'error'; code: ErrorCode; message: string; sessionId?: string }
  | { type: 'pair-result'; status: 'approved' | 'rejected'; deviceId?: string };
