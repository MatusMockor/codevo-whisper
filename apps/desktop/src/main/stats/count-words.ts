const MEANINGFUL = /[\p{L}\p{N}]/u;

export function countWords(text: string): number {
  return text.split(/\s+/u).filter((token) => MEANINGFUL.test(token)).length;
}
