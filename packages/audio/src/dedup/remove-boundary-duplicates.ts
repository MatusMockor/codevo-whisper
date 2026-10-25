import { normalizeWord } from './normalize-word';
import { normalizedWordsMatch } from './words-match';

type Token = { raw: string; word: string };

function tokenize(text: string): Token[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((raw) => raw.length > 0)
    .map((raw) => ({ raw, word: normalizeWord(raw) }));
}

function overlapMatches(previous: string[], next: string[], length: number): boolean {
  const offset = previous.length - length;
  for (let index = 0; index < length; index += 1) {
    if (!normalizedWordsMatch(previous[offset + index] ?? '', next[index] ?? '')) {
      return false;
    }
  }
  return true;
}

function longestOverlap(previous: string[], next: string[], maxOverlapWords: number): number {
  for (let length = Math.min(maxOverlapWords, previous.length, next.length); length > 0; length -= 1) {
    if (overlapMatches(previous, next, length)) {
      return length;
    }
  }
  return 0;
}

function tokensToDrop(tokens: Token[], duplicateWords: number): number {
  let words = 0;
  let index = 0;
  while (index < tokens.length && (words < duplicateWords || tokens[index]?.word === '')) {
    if (tokens[index]?.word !== '') {
      words += 1;
    }
    index += 1;
  }
  return index;
}

function words(tokens: Token[]): string[] {
  return tokens.map((token) => token.word).filter((word) => word.length > 0);
}

export function removeBoundaryDuplicates(previous: string, next: string, maxOverlapWords: number): string {
  const nextTokens = tokenize(next);
  const duplicates = longestOverlap(words(tokenize(previous)), words(nextTokens), maxOverlapWords);
  return nextTokens
    .slice(duplicates === 0 ? 0 : tokensToDrop(nextTokens, duplicates))
    .map((token) => token.raw)
    .join(' ');
}
