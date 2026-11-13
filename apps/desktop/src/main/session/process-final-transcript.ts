import { termKey, type CustomWord } from '../../shared/custom-words';
import type { Settings } from '../../shared/settings';
import { sanitizeInsertionText } from '../insertion/sanitize-insertion-text';
import { fillerWords } from './filler-words';

export type TranscriptSettings = Readonly<Pick<Settings, 'languages' | 'customWords' | 'removeFillerWords' | 'appendTrailingSpace'>>;

const FILLERS = /(?<![\p{L}\p{M}\p{N}'’_./:@\\-])(ehm|eee|hmm|um|uh)(?![\p{L}\p{M}\p{N}'’_/@\\-]|\.[\p{L}\p{M}\p{N}])[,;:.!?…]*/giu;
const WORD_CHUNK = /^([("'“‘«[{]*)([\p{L}\p{M}\p{N}]+(?:['’.-][\p{L}\p{M}\p{N}]+)*)([)"'”’»\]},;:!?.…]*)$/u;
const LETTER_WORD = /^\p{L}+$/u;

function withinOneEdit(left: readonly string[], right: readonly string[]): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let edits = 0;
  let a = 0;
  let b = 0;
  while (a < left.length || b < right.length) {
    if (left[a] === right[b]) {
      a++;
      b++;
      continue;
    }
    if (++edits > 1) return false;
    if (left.length >= right.length) a++;
    if (left.length <= right.length) b++;
  }
  return true;
}

type Chunk = { readonly before: string; readonly word: string; readonly after: string };

type Corrections = {
  readonly terms: ReadonlyMap<string, string>;
  readonly longest: number;
  readonly fuzzy: ReadonlyArray<{ readonly word: string; readonly letters: readonly string[] }>;
};

function corrections(customWords: readonly CustomWord[]): Corrections {
  const terms = new Map(customWords.flatMap(({ word, aliases }) => [word, ...aliases].map((term) => [termKey(term), word] as const)));
  const longest = Math.max(1, ...[...terms.keys()].map((term) => term.split(' ').length));
  const fuzzy = customWords.map(({ word }) => ({ word, letters: [...termKey(word)] }))
    .filter(({ letters }) => letters.length >= 5 && LETTER_WORD.test(letters.join('')));
  return { terms, longest, fuzzy };
}

function chunkOf(text: string): Chunk | null {
  const match = WORD_CHUNK.exec(text);
  if (match === null) return null;
  const [, before = '', word = '', after = ''] = match;
  return { before, word, after };
}

function phraseAt(chunks: ReadonlyArray<Chunk | null>, start: number, table: Corrections): { length: number; text: string } | null {
  for (let length = Math.min(table.longest, chunks.length - start); length >= 2; length--) {
    const span = chunks.slice(start, start + length);
    const last = length - 1;
    if (!span.every((chunk, index): chunk is Chunk => chunk !== null && (index === 0 || chunk.before === '') && (index === last || chunk.after === ''))) continue;
    const preferred = table.terms.get(span.map(({ word }) => termKey(word)).join(' '));
    if (preferred !== undefined) return { length, text: `${span[0]?.before ?? ''}${preferred}${span[last]?.after ?? ''}` };
  }
  return null;
}

function correctToken(text: string, chunk: Chunk | null, table: Corrections): string {
  if (chunk === null) return text;
  const key = termKey(chunk.word);
  const exact = table.terms.get(key);
  if (exact !== undefined) return chunk.before + exact + chunk.after;
  const letters = [...key];
  if (letters.length < 5 || !LETTER_WORD.test(key)) return text;
  const candidates = table.fuzzy.filter((candidate) => candidate.letters[0] === letters[0] && withinOneEdit(letters, candidate.letters));
  const [candidate] = candidates;
  return candidates.length === 1 && candidate !== undefined ? chunk.before + candidate.word + chunk.after : text;
}

function correctWords(text: string, customWords: readonly CustomWord[]): string {
  const table = corrections(customWords);
  const parts = text.split(/(\s+)/u);
  const words = parts.filter((_, index) => index % 2 === 0);
  const gaps = parts.filter((_, index) => index % 2 === 1);
  const chunks = words.map(chunkOf);
  let result = '';
  for (let index = 0; index < words.length;) {
    const phrase = phraseAt(chunks, index, table);
    const length = phrase?.length ?? 1;
    result += (phrase?.text ?? correctToken(words[index] ?? '', chunks[index] ?? null, table)) + (gaps[index + length - 1] ?? '');
    index += length;
  }
  return result;
}

export function processFinalTranscript({ text, settings }: { text: string; settings: TranscriptSettings }): string {
  let result = sanitizeInsertionText(text);
  if (settings.removeFillerWords) {
    const fillers = fillerWords(settings.languages);
    const removed = result.replace(FILLERS, (matched, word: string) => fillers.has(word.toLowerCase()) ? '' : matched);
    result = removed !== result && /^[\p{P}\s]*$/u.test(removed) ? '' : removed;
  }
  return sanitizeInsertionText(correctWords(result, settings.customWords), settings);
}
