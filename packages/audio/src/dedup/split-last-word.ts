import { joinTokens, tokenize } from './tokens';

export type SplitText = { head: string; tail: string | undefined };

export function splitLastWord(text: string): SplitText {
  const tokens = tokenize(text);
  const last = tokens.findLastIndex((token) => token.word.length > 0);
  if (last < 0) {
    return { head: joinTokens(tokens), tail: undefined };
  }
  return { head: joinTokens(tokens.slice(0, last)), tail: joinTokens(tokens.slice(last)) };
}
