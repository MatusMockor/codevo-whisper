import { formatClock, MEETING_DATE, type Meeting } from './meetings';

const UNSAFE_FILE_CHARACTERS = /[\p{Cc}/\\:*?"<>|]/gu;

export function meetingMarkdown({ title, startedAt, durationMs, notes, turns }: Meeting): string {
  const header = [`# ${title}`, '', `- Dátum: ${MEETING_DATE.format(startedAt)}`, `- Trvanie: ${formatClock(durationMs)}`, ''];
  const body = notes === null ? [] : [notes.trim(), ''];
  const transcript = turns.flatMap((turn) => [`**[${formatClock(turn.t0Ms)}] ${turn.speaker}:** ${turn.text}`, '']);
  return [...header, ...body, '## Prepis', '', ...transcript].join('\n');
}

export function meetingFileName({ title }: Pick<Meeting, 'title'>): string {
  return `${title.replace(UNSAFE_FILE_CHARACTERS, '-').trim()}.md`;
}
