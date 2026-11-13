export { pcmToWav, wavHeader } from './wav';
export { runProcess, type ProcessLimits } from './run-process';
export { isLanguageCode, LANGUAGE_CODES, type LanguageCode, type LanguageScore } from './languages';
export {
  DEFAULT_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
  runTranscribeCli,
  type TranscribeBackend,
  type TranscribeCliOptions,
  type TranscribeLanguage,
} from './run-transcribe-cli';
export { runLanguageIdCli, type LanguageIdCliOptions } from './run-language-id-cli';
export { TranscribeCliError, type TranscribeCliFailure } from './transcribe-cli-error';
export type { FrameCodec } from './worker/frame-codec';
export { isVocabularyTerm, MAX_VOCABULARY_TERMS } from './worker/worker-frames';
export { RESIDENT_DEFAULTS, ResidentWorker, type ResidentWorkerOptions } from './worker/resident-worker';
export { ResidentTranscriber, type ResidentTranscriberOptions, type WorkerCall } from './worker/resident-transcriber';
export { ResidentLanguageIdentifier, type LanguageIdCall, type ResidentLanguageIdentifierOptions } from './worker/resident-language-identifier';
