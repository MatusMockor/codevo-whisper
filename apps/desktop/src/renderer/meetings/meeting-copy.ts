import type { MeetingPhase, NotesFailure, SystemAudio } from '../../shared/meetings';
import type { SignalState } from '../home/transcription-route';

const TRANSCRIBING_STEP: Record<Extract<MeetingPhase, { kind: 'transcribing' }>['step'], string> = {
  mic: 'Prepisuje sa mikrofón',
  system: 'Prepisuje sa zvuk systému',
  speakers: 'Rozlišujú sa hovoriaci',
};

const PHASE_TONE: Record<MeetingPhase['kind'], SignalState> = { recording: 'warn', transcribing: 'warn', stopped: 'off', ready: 'ok', failed: 'err' };

const SYSTEM_AUDIO: Record<SystemAudio, string> = { recording: 'nahráva sa', unsupported: 'nedostupný', failed: 'nenahráva sa' };

const RECORDED_SYSTEM_AUDIO: Record<SystemAudio, string> = { recording: 'nahraný', unsupported: 'nedostupný', failed: 'nenahraný' };

const NOTES_FAILURE: Record<NotesFailure, string> = {
  timeout: 'AI server nestihol poznámky vytvoriť včas. Skúste to znova alebo použite rýchlejší model.',
  aborted: 'Vytváranie poznámok sa prerušilo.',
  unreachable: 'AI server sa nepodarilo zastihnúť. Skontrolujte adresu a či server beží.',
  unauthorized: 'AI server odmietol prístup. Skontrolujte API kľúč.',
  http: 'AI server vrátil chybu. Pri dlhom stretnutí skúste zväčšiť kontextové okno modelu.',
  'too-large': 'Odpoveď AI servera je príliš veľká.',
  'bad-response': 'AI server nevrátil použiteľné poznámky. Odpoveď mohla byť prázdna alebo orezaná.',
  'codex-not-found': 'Codex CLI sa nenašiel. Nainštalujte ho alebo skontrolujte PATH.',
  'codex-logged-out': 'Codex CLI nie je prihlásený. Spustite `codex login`.',
  'codex-failed': 'Codex CLI skončil s chybou. Skontrolujte model a verziu Codex CLI.',
  'not-configured': 'Najprv nastavte AI server a model alebo zvoľte Codex CLI.',
  'too-long': 'Prepis je na poznámky príliš dlhý (viac ako 200 000 znakov).',
  empty: 'V prepise nie je žiadna reč, z ktorej by sa dali vytvoriť poznámky.',
  unexpected: 'Poznámky sa nepodarilo vytvoriť. Skúste to znova.',
};

export function phaseLabel(phase: MeetingPhase): string {
  if (phase.kind === 'transcribing') return TRANSCRIBING_STEP[phase.step];
  if (phase.kind === 'recording') return 'Nahráva sa';
  if (phase.kind === 'ready') return 'Prepis hotový';
  if (phase.kind === 'failed') return 'Prepis zlyhal';
  return 'Čaká na prepis';
}

export function phaseTone(phase: MeetingPhase): SignalState {
  return PHASE_TONE[phase.kind];
}

export function systemAudioLabel(state: SystemAudio): string {
  return SYSTEM_AUDIO[state];
}

export function recordedSystemAudioLabel(state: SystemAudio): string {
  return RECORDED_SYSTEM_AUDIO[state];
}

export function notesFailureMessage(failure: NotesFailure): string {
  return NOTES_FAILURE[failure];
}
