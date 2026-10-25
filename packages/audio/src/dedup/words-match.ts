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

const MIN_SHARED_STEM = 4;
const MAX_ENDING_LENGTH = 2;

function sharedPrefixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) {
    length += 1;
  }
  return length;
}

export function endingsDifferOnly(a: string, b: string): boolean {
  if (a.length === 0 || a === b) {
    return a.length > 0;
  }
  const stem = sharedPrefixLength(a, b);
  return stem >= MIN_SHARED_STEM && a.length - stem <= MAX_ENDING_LENGTH && b.length - stem <= MAX_ENDING_LENGTH;
}

export function wordsMatch(a: string, b: string): boolean {
  return normalizedWordsMatch(normalizeWord(a), normalizeWord(b));
}
