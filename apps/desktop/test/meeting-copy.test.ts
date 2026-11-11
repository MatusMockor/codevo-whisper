import { expect, it } from 'vitest';
import { notesFailureMessage, phaseLabel, phaseTone, recordedSystemAudioLabel, systemAudioLabel } from '../src/renderer/meetings/meeting-copy';
import { formatClock, turnLine, type MeetingPhase } from '../src/shared/meetings';

it('formats a clock as mm:ss and adds hours past one hour', () => {
  expect(formatClock(0)).toBe('00:00');
  expect(formatClock(65_400)).toBe('01:05');
  expect(formatClock(3_725_000)).toBe('1:02:05');
});

it('renders a turn as [mm:ss] Speaker: text', () => {
  expect(turnLine({ speaker: 'Ostatní', t0Ms: 7280, t1Ms: 9360, text: 'And so my fellow Americans' })).toBe('[00:07] Ostatní: And so my fellow Americans');
});

it('names every phase and system audio state in Slovak', () => {
  expect(phaseLabel({ kind: 'recording' })).toBe('Nahráva sa');
  expect(phaseLabel({ kind: 'transcribing', step: 'mic' })).toBe('Prepisuje sa mikrofón');
  expect(phaseLabel({ kind: 'transcribing', step: 'system' })).toBe('Prepisuje sa zvuk systému');
  expect(phaseLabel({ kind: 'ready' })).toBe('Prepis hotový');
  expect(phaseLabel({ kind: 'failed', error: 'x' })).toBe('Prepis zlyhal');
  expect(phaseLabel({ kind: 'stopped' })).toBe('Čaká na prepis');
  expect(systemAudioLabel('recording')).toBe('nahráva sa');
  expect(systemAudioLabel('unsupported')).toBe('nedostupný');
  expect(systemAudioLabel('failed')).toBe('nenahráva sa');
  expect(recordedSystemAudioLabel('recording')).toBe('nahraný');
  expect(recordedSystemAudioLabel('unsupported')).toBe('nedostupný');
  expect(recordedSystemAudioLabel('failed')).toBe('nenahraný');
});

it('explains a refused long transcript and a missing AI server in Slovak', () => {
  expect(notesFailureMessage('too-long')).toContain('200 000 znakov');
  expect(notesFailureMessage('not-configured')).toBe('Najprv nastavte AI server a model alebo zvoľte Codex CLI.');
});

it('gives every phase the signal tone of its list marker', () => {
  const phases: MeetingPhase[] = [{ kind: 'recording' }, { kind: 'transcribing', step: 'speakers' }, { kind: 'stopped' }, { kind: 'ready' }, { kind: 'failed', error: 'x' }];
  expect(phases.map(phaseTone)).toEqual(['warn', 'warn', 'off', 'ok', 'err']);
});
