export type ModelOption = { id: string; name: string; available: boolean; default: boolean };

const ALTERNATIVES: readonly (readonly [string, string])[] = [
  ['parakeet-ultra-q8', 'Parakeet Ultra (Q8)'],
  ['whisper-large-v3', 'Whisper Large v3 (F16)'],
  ['whisper-large-v3-q8', 'Whisper Large v3 (Q8)'],
  ['whisper-large-v3-turbo', 'Whisper Large v3 Turbo (F16)'],
  ['whisper-large-v3-turbo-q8', 'Whisper Large v3 Turbo (Q8)'],
];

export const PARAKEET_OPTION: ModelOption = { id: 'parakeet-ultra', name: 'Parakeet Ultra (F16)', available: true, default: true };

export function catalogOptions(installed: readonly string[] = []): ModelOption[] {
  return [PARAKEET_OPTION, ...ALTERNATIVES.map(([id, name]) => ({ id, name, available: installed.includes(id), default: false }))];
}
