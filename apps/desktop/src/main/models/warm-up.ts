import { runTranscribeCli } from '@codevo-whisper/stt-runner';
import { PCM_BYTES_PER_SECOND } from '../../shared/pcm';
import { localBackend, localThreads, type LocalEngineArch } from '../engines/local-backend';

export type WarmUp = (modelPath: string) => Promise<void>;

export type WarmUpDeps = { binary: string; arch: LocalEngineArch };

const WARM_UP_LANGUAGE = 'en';

export function createWarmUp(deps: WarmUpDeps): WarmUp {
  return async (modelPath) => {
    await runTranscribeCli({
      binary: deps.binary,
      model: modelPath,
      backend: localBackend(deps.arch),
      threads: localThreads(),
      language: WARM_UP_LANGUAGE,
      pcm: new Uint8Array(PCM_BYTES_PER_SECOND),
    });
  };
}
