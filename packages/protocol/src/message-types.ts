import type { ErrorCode } from './errors';

export const LANGUAGES = ['sk', 'en', 'cs', 'auto'] as const;

export type Language = (typeof LANGUAGES)[number];

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
  | { type: 'start'; sessionId: string; language: Language }
  | { type: 'audio'; pcm: Uint8Array }
  | { type: 'finish' }
  | { type: 'cancel' }
  | { type: 'pair-request'; deviceName: string };

export type ServerMessage =
  | { type: 'ready'; serverVersion: string }
  | { type: 'final'; segmentId: number; text: string }
  | { type: 'done' }
  | { type: 'flow'; paused: boolean }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'pair-result'; status: 'approved' | 'rejected'; deviceId?: string };
