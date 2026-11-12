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

function correctWords(text: string, customWords: readonly string[]): string {
  const targets = customWords.map((word) => {
    const canonical = word.normalize('NFC');
    return { canonical, normalized: canonical.toLowerCase() };
  });
  return text.replace(/\S+/gu, (chunk) => {
    const match = WORD_CHUNK.exec(chunk);
    if (match === null) return chunk;
    const [, before = '', word = '', after = ''] = match;
    const normalized = word.toLowerCase();
    const exact = targets.filter((target) => target.normalized === normalized);
    const [exactMatch] = exact;
    if (exact.length === 1 && exactMatch !== undefined) return before + exactMatch.canonical + after;
    const letters = [...normalized];
    if (exact.length > 1 || letters.length < 5 || !LETTER_WORD.test(normalized)) return chunk;
    const candidates = targets.filter((target) => {
      const candidate = [...target.normalized];
      return candidate.length >= 5 && candidate[0] === letters[0] && LETTER_WORD.test(target.normalized) && withinOneEdit(letters, candidate);
    });
    const [candidate] = candidates;
    return candidates.length === 1 && candidate !== undefined ? before + candidate.canonical + after : chunk;
  });
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
