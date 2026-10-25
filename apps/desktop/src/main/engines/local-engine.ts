import { runTranscribeCli, type TranscribeBackend } from '@codevo-whisper/stt-runner';
import { access, constants } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import type { Settings } from '../../shared/settings';
import type { ActiveModel } from './active-model';
import { chunkPcm } from './chunk-pcm';
import { EngineUnavailableError, type EngineReadiness, type TranscriptionEngine } from './transcription-engine';

const MAX_THREADS = 4;

const BACKEND_BY_ARCH: Record<LocalEngineArch, TranscribeBackend> = { arm64: 'metal', x64: 'cpu' };

const VERIFICATION_REASON = { missing: 'model-missing', broken: 'model-broken' } as const;

export type LocalEngineArch = 'arm64' | 'x64';

export type LocalEngineDeps = {
  binary: string;
  models: ActiveModel;
  arch: LocalEngineArch;
};

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export class LocalEngine implements TranscriptionEngine {
  readonly id = 'local';

  private readonly threads = Math.min(MAX_THREADS, availableParallelism());

  constructor(private readonly deps: LocalEngineDeps) {}

  async isReady(): Promise<EngineReadiness> {
    if (!(await isExecutable(this.deps.binary))) {
      return { ready: false, reason: 'binary-missing' };
    }
    if ((await this.deps.models.activeModelPath()) === null) {
      return { ready: false, reason: 'no-model' };
    }
    const verification = await this.deps.models.verifyActive();
    if (verification !== 'ok') {
      return { ready: false, reason: VERIFICATION_REASON[verification] };
    }
    return { ready: true };
  }

  async transcribe(pcm: Uint8Array, language: Settings['language'], signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const model = await this.deps.models.activeModelPath();
    if (model === null) {
      throw new EngineUnavailableError('no-model');
    }
    const texts: string[] = [];
    for (const chunk of chunkPcm(pcm)) {
      const text = await this.transcribeChunk(chunk, model, language, signal);
      if (text.length > 0) {
        texts.push(text);
      }
    }
    return texts.join(' ');
  }

  private transcribeChunk(pcm: Uint8Array, model: string, language: Settings['language'], signal: AbortSignal): Promise<string> {
    return runTranscribeCli({
      binary: this.deps.binary,
      model,
      backend: BACKEND_BY_ARCH[this.deps.arch],
      threads: this.threads,
      language,
      pcm,
      signal,
    });
  }
}
