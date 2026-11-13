export type CustomWord = { readonly word: string; readonly aliases: readonly string[] };

export const MAX_CUSTOM_WORDS = 100;
export const MAX_ALIASES = 10;
export const MAX_TERM_LENGTH = 64;
export const MAX_TERM_BYTES = 256;

const TOKEN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’.-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u;

export function termKey(term: string): string {
  return term.normalize('NFC').toLowerCase();
}

function isTerm(value: unknown): value is string {
  return typeof value === 'string' && value === value.normalize('NFC') && [...value].length <= MAX_TERM_LENGTH &&
    new TextEncoder().encode(value).length <= MAX_TERM_BYTES && value.split(' ').every((token) => TOKEN.test(token));
}

function isEntry(value: unknown): value is CustomWord {
  if (typeof value !== 'object' || value === null || Object.keys(value).length !== 2 || !('word' in value) || !('aliases' in value)) {
    return false;
  }
  const { word, aliases } = value;
  return isTerm(word) && Array.isArray(aliases) && aliases.length <= MAX_ALIASES && aliases.every(isTerm);
}

export function isCustomWords(value: unknown): value is readonly CustomWord[] {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_WORDS || !value.every(isEntry)) {
    return false;
  }
  const terms = value.flatMap(({ word, aliases }) => [word, ...aliases].map(termKey));
  return new Set(terms).size === terms.length;
}

function cleanTerm(text: string): string {
  return text.trim().replace(/\s+/gu, ' ').normalize('NFC');
}

function firstOccurrence(): (term: string) => boolean {
  const seen = new Set<string>();
  return (term) => {
    const key = termKey(term);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

export function parseCustomWords(text: string): CustomWord[] {
  const fresh = firstOccurrence();
  return text.split(/\r?\n/u).flatMap((line) => {
    if (line.trim() === '') return [];
    const colon = line.indexOf(':');
    const word = cleanTerm(colon === -1 ? line : line.slice(0, colon));
    if (!fresh(word)) return [];
    const aliases = colon === -1 ? [] : line.slice(colon + 1).split(',').map(cleanTerm).filter((alias) => alias !== '' && fresh(alias));
    return [{ word, aliases }];
  });
}

export function formatCustomWords(words: readonly CustomWord[]): string {
  return words.map(({ word, aliases }) => aliases.length === 0 ? word : `${word}: ${aliases.join(', ')}`).join('\n');
}

export function upgradeLegacyCustomWords(value: unknown): unknown {
  if (!Array.isArray(value) || !value.every((word): word is string => typeof word === 'string')) {
    return value;
  }
  return value.map((word) => word.normalize('NFC')).filter(firstOccurrence()).map((word) => ({ word, aliases: [] }));
}

export function preferredSpellings(words: readonly CustomWord[]): string[] {
  return words.map(({ word }) => word);
}
