import { CliTranscriber } from './cli-transcriber';
import type { SttConfig } from './config';
import type { Transcriber } from './transcriber';
import { WorkerTranscriber } from './worker-transcriber';

export function createTranscriber(config: SttConfig): Transcriber {
  const engine = { model: config.model, backend: config.backend, threads: config.threads };
  if (config.engine === 'cli') {
    return new CliTranscriber({ binary: config.binary, ...engine });
  }
  return new WorkerTranscriber({ binary: config.workerBinary, ...engine });
}
