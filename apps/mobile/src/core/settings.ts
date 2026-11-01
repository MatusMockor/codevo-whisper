import { LANGUAGES, type Language } from '@codevo-whisper/protocol';

export function parseLanguage(value: unknown): Language {
  for (const language of LANGUAGES) if (value === language) return language;
  throw new Error('Invalid voice language');
}
export type SetupStatus = {
  microphone: boolean;
  keyboard: 'disabled' | 'enabled' | 'selected' | 'notApplicable';
};
export function parseSetupStatus(value: unknown): SetupStatus {
  if (typeof value !== 'object' || value === null || !('microphone' in value) || typeof value.microphone !== 'boolean' || !('keyboard' in value)) {
    throw new Error('Invalid setup status');
  }
  switch (value.keyboard) {
    case 'disabled': case 'enabled': case 'selected': case 'notApplicable':
      return { microphone: value.microphone, keyboard: value.keyboard };
    default: throw new Error('Invalid keyboard setup status');
  }
}
export function setupSteps(status: SetupStatus): ('microphone' | 'enableKeyboard' | 'selectKeyboard')[] {
  return [
    ...(!status.microphone ? ['microphone' as const] : []),
    ...(status.keyboard === 'disabled' ? ['enableKeyboard' as const] : []),
    ...(status.keyboard === 'disabled' || status.keyboard === 'enabled' ? ['selectKeyboard' as const] : []),
  ];
}
