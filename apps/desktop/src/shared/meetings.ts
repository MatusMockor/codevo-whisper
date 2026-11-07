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

export type MeetingSummary = { id: string; title: string; startedAt: number; durationMs: number; phase: MeetingPhase; systemAudio: SystemAudio; systemAudioNote: string | null };

export type Meeting = MeetingSummary & { turns: Turn[]; notes: string | null; notesError: string | null };

export const MEETING_ID = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

export function isMeetingId(value: unknown): value is string {
  return typeof value === 'string' && MEETING_ID.test(value);
}
