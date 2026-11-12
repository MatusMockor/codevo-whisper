import { ResidentLanguageIdentifier, ResidentTranscriber, type ResidentWorkerOptions, type TranscribeBackend } from '@codevo-whisper/stt-runner';
import { localThreads } from './local-backend';

export type LocalResidentDeps = { binary: string; acceleratorBinary?: string; callTimeoutMs: number };

export class LocalResidents {
  constructor(
    private readonly deps: LocalResidentDeps,
    readonly backend: TranscribeBackend,
  ) {}

  transcriber(model: string): ResidentTranscriber {
    return new ResidentTranscriber(this.options(model, this.backend));
  }

  identifier(model: string): ResidentLanguageIdentifier {
    return new ResidentLanguageIdentifier(this.options(model, this.backend === 'auto' ? 'cpu' : this.backend));
  }

  private options(model: string, backend: TranscribeBackend): ResidentWorkerOptions {
    const { binary, acceleratorBinary, callTimeoutMs } = this.deps;
    const timeouts = { threads: localThreads(), timeoutMs: callTimeoutMs, startupTimeoutMs: callTimeoutMs };
    if (backend !== 'auto') {
      return { binary, model, backend, ...timeouts };
    }
    return { binary: acceleratorBinary ?? `${binary}-vulkan`, startupFallback: { binary, backend: 'cpu' }, model, backend, ...timeouts };
  }
}
