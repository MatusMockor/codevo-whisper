import type { MeetingPhase, SystemAudio, Turn } from '../../shared/meetings';

const TRANSCRIBING_STEP: Record<Extract<MeetingPhase, { kind: 'transcribing' }>['step'], string> = {
  mic: 'Prepisuje sa mikrofón',
  system: 'Prepisuje sa zvuk systému',
  speakers: 'Rozlišujú sa hovoriaci',
};

const SYSTEM_AUDIO: Record<SystemAudio, string> = { recording: 'nahráva sa', unsupported: 'nedostupný', failed: 'nenahráva sa' };

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
