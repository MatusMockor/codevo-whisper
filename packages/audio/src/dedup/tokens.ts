import { normalizeWord } from './normalize-word';

export type Token = { raw: string; word: string };

export function tokenize(text: string): Token[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((raw) => raw.length > 0)
    .map((raw) => ({ raw, word: normalizeWord(raw) }));
}

export function wordsOf(tokens: Token[]): string[] {
  return tokens.map((token) => token.word).filter((word) => word.length > 0);
}

export function joinTokens(tokens: Token[]): string {
  return tokens.map((token) => token.raw).join(' ');
}
