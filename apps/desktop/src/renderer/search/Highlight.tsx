import { highlightParts } from './text-match';

export function Highlight({ text, terms }: { text: string; terms: readonly string[] }) {
  if (terms.length === 0) {
    return text;
  }
  return highlightParts(text, terms).map((part, index) => (part.hit ? <mark key={index}>{part.text}</mark> : part.text));
}
