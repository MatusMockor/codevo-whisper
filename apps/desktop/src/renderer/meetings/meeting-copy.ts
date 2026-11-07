import type { MeetingPhase, NotesFailure, SystemAudio } from '../../shared/meetings';

export { formatClock } from '../../shared/meetings';

const TRANSCRIBING_STEP: Record<Extract<MeetingPhase, { kind: 'transcribing' }>['step'], string> = {
  mic: 'Prepisuje sa mikrofón',
  system: 'Prepisuje sa zvuk systému',
  speakers: 'Rozlišujú sa hovoriaci',
};

const SYSTEM_AUDIO: Record<SystemAudio, string> = { recording: 'nahráva sa', unsupported: 'nedostupný', failed: 'nenahráva sa' };

const NOTES_FAILURE: Record<NotesFailure, string> = {
  timeout: 'AI server nestihol poznámky vytvoriť včas. Skúste to znova alebo použite rýchlejší model.',
  aborted: 'Vytváranie poznámok sa prerušilo.',
  unreachable: 'AI server sa nepodarilo zastihnúť. Skontrolujte adresu v Nastaveniach a či server beží.',
  unauthorized: 'AI server odmietol prístup. Skontrolujte API kľúč v Nastaveniach.',
  http: 'AI server vrátil chybu. Pri dlhom stretnutí skúste zväčšiť kontextové okno modelu.',
  'too-large': 'Odpoveď AI servera je príliš veľká.',
  'bad-response': 'AI server nevrátil použiteľné poznámky. Odpoveď mohla byť prázdna alebo orezaná.',
  'not-configured': 'Najprv nastavte AI server a model v Nastaveniach v časti „AI úprava textu“.',
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

export function systemAudioLabel(state: SystemAudio): string {
  return SYSTEM_AUDIO[state];
}

export function notesFailureMessage(failure: NotesFailure): string {
  return NOTES_FAILURE[failure];
}
