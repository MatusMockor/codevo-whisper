import type { EngineFailureReason, EngineUnavailableReason } from '../engines/transcription-engine';
import type { CopyLastOutcome, InsertionOutcome, PasteLastOutcome } from '../insertion/insertion-service';
import type { AiFailure } from '../../shared/ai';
import { engineRemedy, type EngineConditions, type EngineProblem, type EngineRemedy } from '../../shared/engine-routing';
import type { OverlayAction, OverlayError, OverlayState } from '../../shared/overlay-contract';
import { primaryLanguage, type LanguageSelection } from '../../shared/dictation-languages';

type ErrorState = OverlayError;
type TerminalState = Extract<OverlayState, { kind: 'inserted' | 'copied' | 'blocked' | 'error' }>;

export const MESSAGES = Object.freeze({
  noModel: 'Lokálny model chýba',
  brokenModel: 'Model chýba alebo je poškodený',
  binaryMissing: 'Chýba program na prepis. Nainštalujte Codevo Whisper znova.',
  languagesRequired: 'Zvolený model potrebuje zvolené jazyky.',
  languagesPackMissing: 'Pre zvolené jazyky chýbajú modely. Stiahnite ich v Nastaveniach.',
  engineUnavailable: 'Prepis teraz nie je dostupný',
  engineSwitchFailed: 'Prepis sa nepodarilo prepnúť. Skontrolujte stránku Prepis.',
  microphone: 'Mikrofón sa nepodarilo zapnúť',
  recordingAudio: 'Zvukový výstup sa nepodarilo nastaviť alebo obnoviť. Skontrolujte zvuk systému.',
  transcriptionFailed: 'Prepis sa nepodaril',
  nothingHeard: 'Nezachytila sa žiadna reč',
  insertFailed: 'Text sa nepodarilo vložiť',
  clipboardFailed: 'Text sa nepodarilo skopírovať do schránky',
  modifiersHeld: 'Pustite klávesy skratky a skúste to znova',
  noTranscript: 'Zatiaľ nemáte žiadny prepis',
  serverNotPaired: 'Server nie je spárovaný',
  serverOffline: 'Server nie je dostupný',
  serverRepair: 'Server treba znova spárovať',
  serverBusy: 'Server je zaneprázdnený, skúste to o chvíľu',
  serverStorage: 'Párovanie servera sa nedá bezpečne uložiť ani načítať',
  serverDisconnected: 'Server je odpojený, diktovanie na ňom sa zastavilo',
  serverLanguagesOutdated: 'Server nepozná výber jazykov. Aktualizujte ho alebo zapnite Automaticky.',
  serverLanguagesMissing: 'Na serveri chýbajú modely pre zvolené jazyky.',
  serverSttUnavailable: 'Prepis na serveri teraz nefunguje',
  serverTooLong: 'Diktovanie je pre server príliš dlhé',
  serverConnectionLost: 'Spojenie so serverom sa prerušilo',
  serverProtocol: 'Server poslal neplatnú odpoveď',
  codexNotFound: 'Codex CLI sa nenašiel. Nainštalujte ho alebo skontrolujte PATH.',
  codexLoggedOut: 'Codex CLI nie je prihlásený. Spustite `codex login`.',
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

function fixError(message: string, action: OverlayAction, alternative?: OverlayAction): ErrorState {
  if (alternative === undefined) {
    return { kind: 'error', message, action };
  }
  return { kind: 'error', message, action, alternative };
}

function remedyError(message: string, problem: EngineProblem): (conditions: EngineConditions) => ErrorState {
  return (conditions) => {
    const remedy = engineRemedy(problem, conditions);
    if (remedy === null) {
      return errorState(message);
    }
    return fixError(message, remedy.action, remedy.alternative);
  };
}

function switchRemedy(problem: EngineProblem | null, conditions: EngineConditions | null): EngineRemedy | null {
  if (problem === null || conditions === null) {
    return null;
  }
  return engineRemedy(problem, conditions);
}

export function switchFailedState(problem: EngineProblem | null, conditions: EngineConditions | null): ErrorState {
  const remedy = switchRemedy(problem, conditions);
  if (remedy === null) {
    return settingsError(MESSAGES.engineSwitchFailed);
  }
  return fixError(MESSAGES.engineSwitchFailed, remedy.action, remedy.alternative);
}

function disconnectedError(conditions: EngineConditions): ErrorState {
  if (conditions.serverOff) {
    return fixError(MESSAGES.serverDisconnected, 'enable-server');
  }
  if (conditions.serverReady) {
    return errorState(MESSAGES.serverDisconnected);
  }
  return remedyError(MESSAGES.serverDisconnected, 'server-not-paired')(conditions);
}

const READINESS_ERRORS: Readonly<Record<EngineUnavailableReason, (conditions: EngineConditions) => ErrorState>> = Object.freeze({
  'no-model': remedyError(MESSAGES.noModel, 'no-model'),
  'model-missing': remedyError(MESSAGES.noModel, 'no-model'),
  'model-broken': () => fixError(MESSAGES.brokenModel, 'download-model'),
  'languages-required': () => settingsError(MESSAGES.languagesRequired),
  'languages-pack-missing': () => fixError(MESSAGES.languagesPackMissing, 'open-languages'),
  'binary-missing': () => errorState(MESSAGES.binaryMissing),
  'server-not-paired': remedyError(MESSAGES.serverNotPaired, 'server-not-paired'),
  'server-offline': remedyError(MESSAGES.serverOffline, 'server-offline'),
  'server-repair-needed': () => serverError(MESSAGES.serverRepair),
  'server-busy': () => errorState(MESSAGES.serverBusy),
  'server-storage': () => errorState(MESSAGES.serverStorage),
  'server-disconnected': disconnectedError,
  'server-languages-outdated': () => serverError(MESSAGES.serverLanguagesOutdated),
  'server-languages-missing': () => serverError(MESSAGES.serverLanguagesMissing),
});

const FAILURE_MESSAGES: Readonly<Record<EngineFailureReason, string>> = Object.freeze({
  'engine-failed': MESSAGES.transcriptionFailed,
  busy: MESSAGES.serverBusy,
  'stt-unavailable': MESSAGES.serverSttUnavailable,
  'languages-outdated': MESSAGES.serverLanguagesOutdated,
  'languages-missing': MESSAGES.serverLanguagesMissing,
  'too-long': MESSAGES.serverTooLong,
  'connection-lost': MESSAGES.serverConnectionLost,
  'repair-needed': MESSAGES.serverRepair,
  protocol: MESSAGES.serverProtocol,
  disconnected: MESSAGES.serverDisconnected,
});

const SERVER_FIXED_FAILURES: ReadonlySet<EngineFailureReason> = new Set(['repair-needed', 'languages-outdated', 'languages-missing']);

export function failureState(reason: EngineFailureReason, hasTextSoFar: boolean): ErrorState {
  if (hasTextSoFar) {
    return { kind: 'error', message: FAILURE_MESSAGES[reason], action: 'copy-last' };
  }
  if (SERVER_FIXED_FAILURES.has(reason)) {
    return serverError(FAILURE_MESSAGES[reason]);
  }
  return errorState(FAILURE_MESSAGES[reason]);
}

export function withRetry(state: ErrorState): ErrorState {
  if (state.action === undefined) return { ...state, action: 'retry' };
  if (state.alternative === undefined) return { ...state, alternative: 'retry' };
  return state;
}

export function readinessError(reason: EngineUnavailableReason | undefined, conditions: EngineConditions): ErrorState {
  if (reason === undefined) {
    return errorState(MESSAGES.engineUnavailable);
  }
  return READINESS_ERRORS[reason](conditions);
}

const COPIED: TerminalState = { kind: 'copied' };

const INSERTION_STATES: Readonly<Record<InsertionOutcome, (appName: string) => TerminalState>> = {
  pasted: (appName) => ({ kind: 'inserted', appName }),
  typed: (appName) => ({ kind: 'inserted', appName }),
  'delivered-submit-blocked': () => errorState('Text bol vložený. Automatické odoslanie bolo zablokované. Odošlite ho ručne.'),
  'delivered-submit-failed': () => errorState('Text bol vložený. Odoslanie sa nepodarilo potvrdiť. Skontrolujte aplikáciu pred opakovaním.'),
  'copied-type-failed': () => errorState('Písanie sa nedokončilo. Text je v schránke. Skontrolujte vložený text pred opakovaním.'),
  'failed-type': () => errorState('Písanie sa nedokončilo. Skontrolujte vložený text pred opakovaním.'),
  'copied-no-text-field': () => COPIED,
  'copied-unverified-target': () => errorState('Cieľové pole sa nedá bezpečne overiť. Text je v schránke. Vložte ho ručne.'),
  'copied-posting-unavailable': () => errorState('Automatické vloženie nie je dostupné. Text je v schránke.'),
  'copied-unsupported-output': () => errorState('Priame písanie v Linuxe nie je dostupné. Text je v schránke.'),
  'copied-by-setting': () => COPIED,
  'copied-paste-failed': () => COPIED,
  'blocked-focus-changed': () => ({ kind: 'blocked', reason: 'focus' }),
  'blocked-secure-input': () => ({ kind: 'blocked', reason: 'secure' }),
  'blocked-modifiers-held': () => errorState(MESSAGES.modifiersHeld),
  'failed-clipboard-write': () => errorState(MESSAGES.clipboardFailed),
  'nothing-to-insert': () => errorState(MESSAGES.nothingHeard),
};

export function insertionState(outcome: InsertionOutcome | null, appName: string): TerminalState {
  if (outcome === null) {
    return errorState(MESSAGES.insertFailed);
  }
  return INSERTION_STATES[outcome](appName);
}

const POLISH_NOTICES: Partial<Record<AiFailure, string>> = Object.freeze({
  'codex-not-found': MESSAGES.codexNotFound,
  'codex-logged-out': MESSAGES.codexLoggedOut,
});

export function withPolishNotice(state: TerminalState, failure: AiFailure | null): TerminalState {
  const notice = failure === null ? undefined : POLISH_NOTICES[failure];
  return (state.kind === 'inserted' || state.kind === 'copied') && notice !== undefined ? { ...state, notice } : state;
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

export function languageChip(selection: LanguageSelection): string {
  const primary = primaryLanguage(selection);
  if (selection.mode === 'auto' || primary === null) {
    return 'AUTO';
  }
  const others = selection.selected.length - 1;
  if (others === 0) {
    return primary.toUpperCase();
  }
  return `${primary.toUpperCase()} +${others}`;
}
