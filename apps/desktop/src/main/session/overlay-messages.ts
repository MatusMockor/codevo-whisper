import type { EngineUnavailableReason } from '../engines/transcription-engine';
import type { CopyLastOutcome, InsertionOutcome, PasteLastOutcome } from '../insertion/insertion-service';
import type { OverlayState } from '../../shared/overlay-contract';
import type { Language } from '../../shared/settings';

type ErrorState = Extract<OverlayState, { kind: 'error' }>;

export const MESSAGES = Object.freeze({
  noModel: 'Nemáte stiahnutý model',
  brokenModel: 'Model chýba alebo je poškodený',
  binaryMissing: 'Chýba program na prepis. Nainštalujte Codevo Whisper znova.',
  languageRequired: 'Zvolený model potrebuje nastavený jazyk',
  engineUnavailable: 'Prepis teraz nie je dostupný',
  microphone: 'Mikrofón sa nepodarilo zapnúť',
  transcriptionFailed: 'Prepis sa nepodaril',
  nothingHeard: 'Nezachytila sa žiadna reč',
  insertFailed: 'Text sa nepodarilo vložiť',
  clipboardFailed: 'Text sa nepodarilo skopírovať do schránky',
  modifiersHeld: 'Pustite ⌃ a ⌘ a skúste to znova',
  noTranscript: 'Zatiaľ nemáte žiadny prepis',
});

export function errorState(message: string): ErrorState {
  return { kind: 'error', message };
}

function settingsError(message: string): ErrorState {
  return { kind: 'error', message, action: 'open-settings' };
}

const READINESS_ERRORS: Readonly<Record<EngineUnavailableReason, ErrorState>> = Object.freeze({
  'no-model': settingsError(MESSAGES.noModel),
  'model-missing': settingsError(MESSAGES.brokenModel),
  'model-broken': settingsError(MESSAGES.brokenModel),
  'language-required': settingsError(MESSAGES.languageRequired),
  'binary-missing': errorState(MESSAGES.binaryMissing),
});

export function readinessError(reason: EngineUnavailableReason | undefined): ErrorState {
  if (reason === undefined) {
    return errorState(MESSAGES.engineUnavailable);
  }
  return READINESS_ERRORS[reason];
}

const COPIED: OverlayState = { kind: 'copied' };

const INSERTION_STATES: Readonly<Record<InsertionOutcome, (appName: string) => OverlayState>> = {
  pasted: (appName) => ({ kind: 'inserted', appName }),
  'copied-no-text-field': () => COPIED,
  'copied-by-setting': () => COPIED,
  'copied-paste-failed': () => COPIED,
  'blocked-focus-changed': () => ({ kind: 'blocked', reason: 'focus' }),
  'blocked-secure-input': () => ({ kind: 'blocked', reason: 'secure' }),
  'blocked-modifiers-held': () => errorState(MESSAGES.modifiersHeld),
  'failed-clipboard-write': () => errorState(MESSAGES.clipboardFailed),
};

export function insertionState(outcome: InsertionOutcome | null, appName: string): OverlayState {
  if (outcome === null) {
    return errorState(MESSAGES.insertFailed);
  }
  return INSERTION_STATES[outcome](appName);
}

export function pasteLastState(outcome: PasteLastOutcome, appName: string): OverlayState {
  if (outcome === 'no-transcript') {
    return errorState(MESSAGES.noTranscript);
  }
  return insertionState(outcome, appName);
}

const COPY_LAST_STATES: Readonly<Record<CopyLastOutcome, OverlayState>> = Object.freeze({
  copied: COPIED,
  'no-transcript': errorState(MESSAGES.noTranscript),
  'failed-clipboard-write': errorState(MESSAGES.clipboardFailed),
});

export function copyLastState(outcome: CopyLastOutcome): OverlayState {
  return COPY_LAST_STATES[outcome];
}

export function languageChip(language: Language): string {
  return language.toUpperCase();
}
