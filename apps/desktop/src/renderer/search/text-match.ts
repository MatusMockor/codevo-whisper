export type TextPart = { text: string; hit: boolean };

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function searchTerms(query: string): readonly string[] {
  return fold(query)
    .split(/\s+/u)
    .filter((term) => term !== '');
}

export function matchesTerms(haystack: string, terms: readonly string[]): boolean {
  const folded = fold(haystack);
  return terms.every((term) => folded.includes(term));
}

type FoldedText = { folded: string; origins: readonly number[] };

function foldWithOrigins(text: string): FoldedText {
  let folded = '';
  const origins: number[] = [];
  let offset = 0;
  for (const char of text) {
    const part = fold(char);
    origins.push(...Array.from(part, () => offset));
    folded += part;
    offset += char.length;
  }
  origins.push(text.length);
  return { folded, origins };
}

function hitMask(text: string, terms: readonly string[]): readonly boolean[] {
  const { folded, origins } = foldWithOrigins(text);
  const units = Array.from({ length: text.length }, () => false);
  for (const term of terms) {
    let start = folded.indexOf(term);
    while (start !== -1) {
      const from = origins[start] ?? text.length;
      const to = origins[start + term.length] ?? text.length;
      units.fill(true, from, to);
      start = folded.indexOf(term, start + term.length);
    }
  }
  return units;
}

export function highlightParts(text: string, terms: readonly string[]): readonly TextPart[] {
  if (terms.length === 0) {
    return [{ text, hit: false }];
  }
  const mask = hitMask(text, terms);
  const parts: TextPart[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const hit = mask[index] === true;
    const last = parts.at(-1);
    if (last !== undefined && last.hit === hit) {
      last.text += text.charAt(index);
      continue;
    }
    parts.push({ text: text.charAt(index), hit });
  }
  return parts.length === 0 ? [{ text, hit: false }] : parts;
}
