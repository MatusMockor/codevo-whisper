import { expect, it } from 'vitest';
import { meetingFileName, meetingMarkdown } from '../src/shared/meeting-markdown';
import { MEETING_DATE, type Meeting } from '../src/shared/meetings';

const MEETING: Meeting = {
  id: '20261107-090503-abcdef',
  title: 'Stretnutie 7. 11. 2026 9:05',
  startedAt: new Date(2026, 10, 7, 9, 5).getTime(),
  durationMs: 3_725_000,
  phase: { kind: 'ready' },
  systemAudio: 'recording',
  systemAudioNote: null,
  notesPending: false,
  notesError: null,
  turns: [
    { speaker: 'Ja', t0Ms: 0, t1Ms: 2_000, text: 'Dobrý deň.' },
    { speaker: 'Hovoriaci 2', t0Ms: 65_400, t1Ms: 70_000, text: 'Piatok nám vyhovuje.' },
  ],
  notes: '## Zhrnutie\n\nDohodli sme termín.\n',
};

it('exports the title, date, duration, notes and then the transcript', () => {
  expect(meetingMarkdown(MEETING)).toBe(
    [
      '# Stretnutie 7. 11. 2026 9:05',
      '',
      `- Dátum: ${MEETING_DATE.format(MEETING.startedAt)}`,
      '- Trvanie: 1:02:05',
      '',
      '## Zhrnutie',
      '',
      'Dohodli sme termín.',
      '',
      '## Prepis',
      '',
      '**[00:00] Ja:** Dobrý deň.',
      '',
      '**[01:05] Hovoriaci 2:** Piatok nám vyhovuje.',
      '',
    ].join('\n'),
  );
});

it('exports only the transcript when there are no notes yet', () => {
  const markdown = meetingMarkdown({ ...MEETING, notes: null });

  expect(markdown).toContain('- Trvanie: 1:02:05\n\n## Prepis\n');
});

it('names the file after the title without characters a file system rejects', () => {
  expect(meetingFileName({ ...MEETING, title: 'Plán: Q4/2026 "draft" *?<>|\\' })).toBe('Plán- Q4-2026 -draft- ------.md');
  expect(meetingFileName(MEETING)).toBe('Stretnutie 7. 11. 2026 9-05.md');
});
