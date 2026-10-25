import { editDistance } from './edit-distance';
import { normalizeWord } from './normalize-word';

function allowedEdits(shorterLength: number): number {
  if (shorterLength >= 7) {
    return 2;
  }
  if (shorterLength >= 4) {
    return 1;
  }
  return 0;
}

export function normalizedWordsMatch(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  if (a === b) {
    return true;
  }
  return editDistance(a, b) <= allowedEdits(Math.min(a.length, b.length));
}

export function wordsMatch(a: string, b: string): boolean {
  return normalizedWordsMatch(normalizeWord(a), normalizeWord(b));
}
