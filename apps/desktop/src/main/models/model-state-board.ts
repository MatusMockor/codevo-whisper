import type { Logger } from '../logging/logger';
import type { ModelState } from '../../shared/models';

export const PROGRESS_INTERVAL_MS = 250;

export type ModelStatesListener = (states: ModelState[]) => void;

export type ModelStatePatch = Partial<Omit<ModelState, 'id' | 'totalBytes'>>;

export class ModelStateBoard {
  private readonly current = new Map<string, ModelState>();
  private readonly listeners = new Set<ModelStatesListener>();
  private lastEmitAt = Number.NEGATIVE_INFINITY;

  constructor(
    initial: readonly ModelState[],
    private readonly logger: Logger,
  ) {
    for (const state of initial) {
      this.current.set(state.id, state);
    }
  }

  snapshot(): ModelState[] {
    return [...this.current.values()].map((state) => ({ ...state }));
  }

  get(id: string): ModelState | undefined {
    return this.current.get(id);
  }

  set(id: string, patch: ModelStatePatch): void {
    const previous = this.current.get(id);
    if (previous === undefined) {
      return;
    }
    const next = { ...previous, ...patch };
    this.current.set(id, next);
    if (next.status === previous.status && next.receivedBytes === previous.receivedBytes) {
      return;
    }
    this.emit();
  }

  progress(id: string, receivedBytes: number): void {
    const previous = this.current.get(id);
    if (previous === undefined) {
      return;
    }
    this.current.set(id, { ...previous, receivedBytes });
    if (Date.now() - this.lastEmitAt < PROGRESS_INTERVAL_MS) {
      return;
    }
    this.emit();
  }

  onChange(listener: ModelStatesListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.lastEmitAt = Date.now();
    const states = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(states);
      } catch (error) {
        this.logger.error('Model state listener failed', error);
      }
    }
  }
}
