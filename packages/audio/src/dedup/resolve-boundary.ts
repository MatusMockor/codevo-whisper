import { joinTokens, tokenize, wordsOf, type Token } from './tokens';
import { endingsDifferOnly, isFragmentOf, isTruncationOf, normalizedWordsMatch } from './words-match';

type Boundary = {
  carriedLast: boolean;
  lowercaseLead: boolean;
};

function fragmentAllowed(length: number, boundary: Boundary): boolean {
  return boundary.lowercaseLead && (length > 1 || boundary.carriedLast);
}

function pairMatches(previous: string, next: string, position: number, length: number, boundary: Boundary): boolean {
  const similar = length === 1 ? endingsDifferOnly(previous, next) : normalizedWordsMatch(previous, next);
  if (similar) {
    return true;
  }
  if (position === 0 && fragmentAllowed(length, boundary) && isFragmentOf(next, previous)) {
    return true;
  }
  return boundary.carriedLast && position === length - 1 && isTruncationOf(previous, next);
}

function overlapMatches(previous: string[], next: string[], length: number, boundary: Boundary): boolean {
  const offset = previous.length - length;
  for (let index = 0; index < length; index += 1) {
    if (!pairMatches(previous[offset + index] ?? '', next[index] ?? '', index, length, boundary)) {
      return false;
    }
  }
  return true;
}

function longestOverlap(previous: string[], next: string[], maxOverlapWords: number, boundary: Boundary): number {
  for (let length = Math.min(maxOverlapWords, previous.length, next.length); length > 0; length -= 1) {
    if (overlapMatches(previous, next, length, boundary)) {
      return length;
    }
  }
  return 0;
}

function wordTokenIndices(tokens: Token[]): number[] {
  return tokens.flatMap((token, index) => (token.word.length > 0 ? [index] : []));
}

function tokensAfterWords(tokens: Token[], words: number): Token[] {
  const indices = wordTokenIndices(tokens);
  const next = indices[words];
  return next === undefined ? [] : tokens.slice(next);
}

function startsLowercase(token: Token | undefined): boolean {
  return token !== undefined && /^[^\p{L}]*\p{Ll}/u.test(token.raw);
}

function resolveWithCarry(carriedTokens: Token[], nextTokens: Token[], duplicates: number): Token[] {
  const fromLastDuplicate = tokensAfterWords(nextTokens, duplicates - 1);
  const nextVersion = fromLastDuplicate.find((token) => token.word.length > 0);
  const carriedWord = wordsOf(carriedTokens).at(-1) ?? '';
  if (nextVersion === undefined || isFragmentOf(nextVersion.word, carriedWord)) {
    return [...carriedTokens, ...tokensAfterWords(nextTokens, duplicates)];
  }
  return fromLastDuplicate;
}

export function resolveBoundary(previous: string, carried: string | undefined, next: string, maxOverlapWords: number): string {
  const nextTokens = tokenize(next);
  const carriedTokens = carried === undefined ? [] : tokenize(carried);
  const boundary: Boundary = {
    carriedLast: wordsOf(carriedTokens).length > 0,
    lowercaseLead: startsLowercase(nextTokens.find((token) => token.word.length > 0)),
  };
  const duplicates = longestOverlap(wordsOf([...tokenize(previous), ...carriedTokens]), wordsOf(nextTokens), maxOverlapWords, boundary);
  if (duplicates === 0) {
    return joinTokens([...carriedTokens, ...nextTokens]);
  }
  if (!boundary.carriedLast) {
    return joinTokens(tokensAfterWords(nextTokens, duplicates));
  }
  return joinTokens(resolveWithCarry(carriedTokens, nextTokens, duplicates));
}

export function removeBoundaryDuplicates(previous: string, next: string, maxOverlapWords: number): string {
  return resolveBoundary(previous, undefined, next, maxOverlapWords);
}
