import type { NotesFailure } from '../../shared/meetings';
import { AI_SECTION, MICROPHONE_SECTION, MODEL_SECTION, type NavTarget } from '../navigation';

export type MeetingRemedy = { id: string; label: string; target: NavTarget };

export const SET_UP_AI: MeetingRemedy = Object.freeze({ id: 'set-up-ai', label: 'Nastaviť AI úpravu', target: AI_SECTION });

export const DOWNLOAD_MODEL: MeetingRemedy = Object.freeze({ id: 'download-model', label: 'Stiahnuť model', target: MODEL_SECTION });

const CHECK_MICROPHONE: MeetingRemedy = Object.freeze({ id: 'check-microphone', label: 'Skontrolovať mikrofón', target: MICROPHONE_SECTION });

const CHECK_MODEL: MeetingRemedy = Object.freeze({ id: 'check-model', label: 'Skontrolovať lokálny model', target: MODEL_SECTION });

const CHECK_AI_SERVER: MeetingRemedy = Object.freeze({ id: 'check-ai-server', label: 'Skontrolovať AI server', target: AI_SECTION });

const CHECK_CODEX: MeetingRemedy = Object.freeze({ id: 'check-codex', label: 'Skontrolovať Codex CLI', target: AI_SECTION });

export const START_FAILURE_REMEDIES: readonly MeetingRemedy[] = Object.freeze([CHECK_MICROPHONE, CHECK_MODEL]);

const NOTES_REMEDIES: Readonly<Partial<Record<NotesFailure, MeetingRemedy>>> = Object.freeze({
  'not-configured': SET_UP_AI,
  timeout: CHECK_AI_SERVER,
  unreachable: CHECK_AI_SERVER,
  unauthorized: CHECK_AI_SERVER,
  http: CHECK_AI_SERVER,
  'bad-response': CHECK_AI_SERVER,
  'codex-not-found': CHECK_CODEX,
  'codex-logged-out': CHECK_CODEX,
  'codex-failed': CHECK_CODEX,
});

export function notesRemedy(failure: NotesFailure): MeetingRemedy | null {
  return NOTES_REMEDIES[failure] ?? null;
}
