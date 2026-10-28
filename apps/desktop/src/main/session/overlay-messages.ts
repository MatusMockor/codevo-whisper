import type { EngineFailureReason, EngineUnavailableReason } from '../engines/transcription-engine';
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
  serverNotPaired: 'Server nie je spárovaný',
  serverOffline: 'Server nie je dostupný',
  serverRepair: 'Server treba znova spárovať',
  serverBusy: 'Server je zaneprázdnený, skúste to o chvíľu',
  serverStorage: 'Párovanie servera sa nedá bezpečne uložiť ani načítať',
  serverSttUnavailable: 'Prepis na serveri teraz nefunguje',
  serverTooLong: 'Diktovanie je pre server príliš dlhé',
  serverConnectionLost: 'Spojenie so serverom sa prerušilo',
  serverProtocol: 'Server poslal neplatnú odpoveď',
});

export function errorState(message: string): ErrorState {
  return { kind: 'error', message };
}

function settingsError(message: string): ErrorState {
  return { kind: 'error', message, action: 'open-settings' };
}

function serverError(message: string): ErrorState {
  return { kind: 'error', message, action: 'open-server' };
}

const READINESS_ERRORS: Readonly<Record<EngineUnavailableReason, ErrorState>> = Object.freeze({
  'no-model': settingsError(MESSAGES.noModel),
  'model-missing': settingsError(MESSAGES.brokenModel),
  'model-broken': settingsError(MESSAGES.brokenModel),
  'language-required': settingsError(MESSAGES.languageRequired),
  'binary-missing': errorState(MESSAGES.binaryMissing),
  'server-not-paired': serverError(MESSAGES.serverNotPaired),
  'server-offline': errorState(MESSAGES.serverOffline),
  'server-repair-needed': serverError(MESSAGES.serverRepair),
  'server-busy': errorState(MESSAGES.serverBusy),
  'server-storage': errorState(MESSAGES.serverStorage),
});

const FAILURE_MESSAGES: Readonly<Record<EngineFailureReason, string>> = Object.freeze({
  'engine-failed': MESSAGES.transcriptionFailed,
  busy: MESSAGES.serverBusy,
  'stt-unavailable': MESSAGES.serverSttUnavailable,
  'too-long': MESSAGES.serverTooLong,
  'connection-lost': MESSAGES.serverConnectionLost,
  'repair-needed': MESSAGES.serverRepair,
  protocol: MESSAGES.serverProtocol,
});

export function failureState(reason: EngineFailureReason, hasTextSoFar: boolean): ErrorState {
  if (hasTextSoFar) {
    return { kind: 'error', message: FAILURE_MESSAGES[reason], action: 'copy-last' };
  }
  if (reason === 'repair-needed') {
    return serverError(FAILURE_MESSAGES[reason]);
  }
  return errorState(FAILURE_MESSAGES[reason]);
}

export function readinessError(reason: EngineUnavailableReason | undefined): ErrorState {
  if (reason === undefined) {
    return errorState(MESSAGES.engineUnavailable);
  }
  return READINESS_ERRORS[reason];
}

const COPIED: OverlayState = { kind: 'copied' };

const INSERTION_STATES: Readonly<Record<InsertionOutcome, (appName: string) => OverlayState>> = {
  pasted: (appName) => ({ kind: 'inserted', appName }),
  typed: (appName) => ({ kind: 'inserted', appName }),
  'delivered-submit-blocked': () => errorState('Text bol vložený. Automatické odoslanie bolo zablokované. Odošlite ho ručne.'),
  'delivered-submit-failed': () => errorState('Text bol vložený. Odoslanie sa nepodarilo potvrdiť. Skontrolujte aplikáciu pred opakovaním.'),
  'copied-type-failed': () => errorState('Písanie sa nedokončilo. Text je v schránke. Skontrolujte vložený text pred opakovaním.'),
  'failed-type': () => errorState('Písanie sa nedokončilo. Skontrolujte vložený text pred opakovaním.'),
  'copied-no-text-field': () => COPIED,
  'copied-by-setting': () => COPIED,
  'copied-paste-failed': () => COPIED,
  'blocked-focus-changed': () => ({ kind: 'blocked', reason: 'focus' }),
  'blocked-secure-input': () => ({ kind: 'blocked', reason: 'secure' }),
  'blocked-modifiers-held': () => errorState(MESSAGES.modifiersHeld),
  'failed-clipboard-write': () => errorState(MESSAGES.clipboardFailed),
  'nothing-to-insert': () => errorState(MESSAGES.nothingHeard),
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
