import { joinTokens, tokenize, wordsOf, type Token } from './tokens';
import { endingsDifferOnly, isFragmentOf, isTruncationOf, normalizedWordsMatch } from './words-match';

function pairMatches(previous: string, next: string, position: number, length: number, carriedLast: boolean): boolean {
  const similar = length === 1 ? endingsDifferOnly(previous, next) : normalizedWordsMatch(previous, next);
  if (similar) {
    return true;
  }
  if (position === 0 && isFragmentOf(next, previous)) {
    return true;
  }
  return carriedLast && position === length - 1 && isTruncationOf(previous, next);
}

function overlapMatches(previous: string[], next: string[], length: number, carriedLast: boolean): boolean {
  const offset = previous.length - length;
  for (let index = 0; index < length; index += 1) {
    if (!pairMatches(previous[offset + index] ?? '', next[index] ?? '', index, length, carriedLast)) {
      return false;
    }
  }
  return true;
}

function longestOverlap(previous: string[], next: string[], maxOverlapWords: number, carriedLast: boolean): number {
  for (let length = Math.min(maxOverlapWords, previous.length, next.length); length > 0; length -= 1) {
    if (overlapMatches(previous, next, length, carriedLast)) {
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

function wordToken(tokens: Token[], wordIndex: number): Token | undefined {
  return tokens.filter((token) => token.word.length > 0)[wordIndex];
}

function carriedOrNext(carried: Token[], nextVersion: Token | undefined): Token[] {
  const carriedWord = wordsOf(carried).at(-1) ?? '';
  if (nextVersion === undefined || isFragmentOf(nextVersion.word, carriedWord)) {
    return carried;
  }
  return [nextVersion];
}

export function resolveBoundary(previous: string, carried: string | undefined, next: string, maxOverlapWords: number): string {
  const nextTokens = tokenize(next);
  const carriedTokens = carried === undefined ? [] : tokenize(carried);
  const hasCarry = wordsOf(carriedTokens).length > 0;
  const duplicates = longestOverlap(wordsOf([...tokenize(previous), ...carriedTokens]), wordsOf(nextTokens), maxOverlapWords, hasCarry);
  if (duplicates === 0) {
    return joinTokens([...carriedTokens, ...nextTokens]);
  }
  const rest = nextTokens.slice(tokensToDrop(nextTokens, duplicates));
  if (!hasCarry) {
    return joinTokens(rest);
  }
  return joinTokens([...carriedOrNext(carriedTokens, wordToken(nextTokens, duplicates - 1)), ...rest]);
}

export function removeBoundaryDuplicates(previous: string, next: string, maxOverlapWords: number): string {
  return resolveBoundary(previous, undefined, next, maxOverlapWords);
}
