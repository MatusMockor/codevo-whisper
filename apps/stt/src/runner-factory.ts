import type { TranscribeBackend } from '@codevo-whisper/stt-runner';
import { CliLanguageIdentifier } from './cli-language-identifier';
import { CliTranscriber } from './cli-transcriber';
import type { SttConfig } from './config';
import type { LanguageIdRunner } from './language-id-runner';
import type { Transcriber } from './transcriber';
import { WorkerLanguageIdentifier } from './worker-language-identifier';
import { WorkerTranscriber } from './worker-transcriber';

export type ModelRun = { model: string; backend: TranscribeBackend };

export interface RunnerFactory {
  transcriber(run: ModelRun): Transcriber;
  identifier(run: ModelRun): LanguageIdRunner;
}

class WorkerRunnerFactory implements RunnerFactory {
  constructor(private readonly config: SttConfig) {}

  transcriber(run: ModelRun): Transcriber {
    return new WorkerTranscriber({ binary: this.config.workerBinary, threads: this.config.threads, ...run });
  }

  identifier(run: ModelRun): LanguageIdRunner {
    return new WorkerLanguageIdentifier({ binary: this.config.workerBinary, threads: this.config.threads, ...run });
  }
}

class CliRunnerFactory implements RunnerFactory {
  constructor(private readonly config: SttConfig) {}

  transcriber(run: ModelRun): Transcriber {
    return new CliTranscriber({ binary: this.config.binary, threads: this.config.threads, ...run });
  }

  identifier(run: ModelRun): LanguageIdRunner {
    return new CliLanguageIdentifier({ binary: this.config.binary, threads: this.config.threads, ...run });
  }
}

export function runnerFactoryFor(config: SttConfig): RunnerFactory {
  if (config.engine === 'cli') {
    return new CliRunnerFactory(config);
  }
  return new WorkerRunnerFactory(config);
}
