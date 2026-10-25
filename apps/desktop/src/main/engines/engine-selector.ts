import type { EngineId } from '../../shared/settings';
import type { Preparation, TranscriptionEngine } from './transcription-engine';

const NOT_READY: Preparation = { ready: false };

export class EngineSelector {
  constructor(private readonly engines: readonly TranscriptionEngine[]) {}

  async prepare(order: readonly EngineId[]): Promise<Preparation> {
    let primary: Preparation | null = null;
    for (const id of order) {
      const engine = this.engines.find((candidate) => candidate.id === id);
      if (engine === undefined) {
        continue;
      }
      const preparation = await engine.prepare();
      if (preparation.ready) {
        return preparation;
      }
      primary ??= preparation;
    }
    return primary ?? NOT_READY;
  }
}
