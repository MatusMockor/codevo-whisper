import type { TranscriptionModel, TranscriptionModelReport } from './transcription-model';

export type ModelLookup = { kind: 'found'; model: TranscriptionModel } | { kind: 'unknown' } | { kind: 'unavailable' };

const UNKNOWN: ModelLookup = { kind: 'unknown' };
const UNAVAILABLE: ModelLookup = { kind: 'unavailable' };

export class TranscriptionModelCatalog {
  private readonly models: readonly TranscriptionModel[];

  constructor(
    private readonly defaultModel: TranscriptionModel,
    alternatives: readonly TranscriptionModel[] = [],
  ) {
    this.models = [defaultModel, ...alternatives];
    if (new Set(this.models.map((model) => model.id)).size !== this.models.length) {
      throw new RangeError('transcription model ids must be unique');
    }
  }

  lookup(id: string | null): ModelLookup {
    if (id === null) {
      return { kind: 'found', model: this.defaultModel };
    }
    const model = this.models.find((candidate) => candidate.id === id);
    if (model === undefined) {
      return UNKNOWN;
    }
    if (!model.available()) {
      return UNAVAILABLE;
    }
    return { kind: 'found', model };
  }

  report(): TranscriptionModelReport[] {
    return this.models.map((model) => ({ id: model.id, name: model.name, available: model.available(), default: model === this.defaultModel }));
  }
}
