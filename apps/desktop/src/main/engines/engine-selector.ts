import type { EngineId } from '../../shared/settings';
import type { EngineUnavailableReason, Preparation, TranscriptionEngine } from './transcription-engine';

const NOT_READY: Preparation = { ready: false };

const TERMINAL_REASONS: ReadonlySet<EngineUnavailableReason> = new Set(['server-repair-needed']);

const EAGER_ENGINES: ReadonlySet<EngineId> = new Set(['local']);

function isTerminal(preparation: Preparation): boolean {
  return !preparation.ready && preparation.reason !== undefined && TERMINAL_REASONS.has(preparation.reason);
}

type Candidate = { engine: TranscriptionEngine; preparation: Promise<Preparation> | null };

function releaseReady(preparation: Promise<Preparation> | null): void {
  void preparation?.then(
    (settled) => {
      if (settled.ready) {
        settled.engine.release();
      }
    },
    () => undefined,
  );
}

export class EngineSelector {
  constructor(private readonly engines: readonly TranscriptionEngine[]) {}

  async prepare(order: readonly EngineId[]): Promise<Preparation> {
    const candidates = this.candidates(order);
    let primary: Preparation | null = null;
    for (const [index, candidate] of candidates.entries()) {
      const preparation = await (candidate.preparation ?? candidate.engine.prepare());
      if (preparation.ready || isTerminal(preparation)) {
        candidates.slice(index + 1).forEach((rest) => releaseReady(rest.preparation));
        return preparation;
      }
      primary ??= preparation;
    }
    return primary ?? NOT_READY;
  }

  private candidates(order: readonly EngineId[]): Candidate[] {
    return order.flatMap((id, index): Candidate[] => {
      const engine = this.engines.find((candidate) => candidate.id === id);
      if (engine === undefined) {
        return [];
      }
      if (index === 0 || !EAGER_ENGINES.has(id)) {
        return [{ engine, preparation: null }];
      }
      const preparation = engine.prepare();
      preparation.catch(() => undefined);
      return [{ engine, preparation }];
    });
  }
}
