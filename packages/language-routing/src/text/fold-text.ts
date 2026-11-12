export function foldText(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\p{M}\p{P}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}
