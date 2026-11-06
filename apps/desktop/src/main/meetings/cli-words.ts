import type { Word } from '../../shared/meetings';

const WORDS_HEADER = /^words: \d+$/;
const WORD_LINE = /^\s*\[\s*(\d+\.\d+)\s*->\s*(\d+\.\d+)\]\s?(.*)$/;

function toMs(seconds: string): number {
  return Math.round(Number(seconds) * 1000);
}

export function parseCliWords(stdout: string): Word[] {
  const lines = stdout.split('\n');
  const start = lines.findIndex((line) => WORDS_HEADER.test(line.trim()));
  if (start === -1) {
    return [];
  }
  const words: Word[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = WORD_LINE.exec(line);
    if (match === null) {
      break;
    }
    const text = (match[3] ?? '').trim();
    if (text !== '') {
      words.push({ t0Ms: toMs(match[1] ?? '0'), t1Ms: toMs(match[2] ?? '0'), text });
    }
  }
  return words;
}
