import { MAX_TEXT_CHARS } from '@codevo-whisper/protocol';

export function limitText(text: string): string {
  const characters = [...text];
  if (characters.length <= MAX_TEXT_CHARS) {
    return text;
  }
  return characters.slice(0, MAX_TEXT_CHARS).join('');
}
