import type { AiFailure } from './ai';

export type MeetingTrack = 'mic' | 'system';

export type SystemAudio = 'recording' | 'unsupported' | 'failed';

export type Word = { t0Ms: number; t1Ms: number; text: string };

export type SpeakerSegment = { t0Ms: number; t1Ms: number; speaker: number };

export type Turn = { speaker: string; t0Ms: number; t1Ms: number; text: string };

export type MeetingPhase =
  | { kind: 'recording' }
  | { kind: 'stopped' }
  | { kind: 'transcribing'; step: 'mic' | 'system' | 'speakers' }
  | { kind: 'ready' }
  | { kind: 'failed'; error: string };

export type NotesFailure = AiFailure | 'not-configured' | 'too-long' | 'empty' | 'unexpected';

export type MeetingSummary = {
  id: string;
  title: string;
  startedAt: number;
  durationMs: number;
  phase: MeetingPhase;
  systemAudio: SystemAudio;
  systemAudioNote: string | null;
  notesPending: boolean;
  notesError: NotesFailure | null;
};

export type Meeting = MeetingSummary & { turns: Turn[]; notes: string | null };

export const MEETING_ID = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

export function isMeetingId(value: unknown): value is string {
  return typeof value === 'string' && MEETING_ID.test(value);
}

export const MEETING_DATE = new Intl.DateTimeFormat('sk', { dateStyle: 'medium', timeStyle: 'short' });

const pad = (value: number) => String(value).padStart(2, '0');

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const clock = `${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
  return hours === 0 ? clock : `${hours}:${clock}`;
}

export function turnLine(turn: Turn): string {
  return `[${formatClock(turn.t0Ms)}] ${turn.speaker}: ${turn.text}`;
}
