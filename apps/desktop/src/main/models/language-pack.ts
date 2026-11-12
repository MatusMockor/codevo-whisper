import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import type { AuxiliaryModelView, LanguagePackView, ModelState } from '../../shared/models';
import type { CatalogEntry } from './catalog-entry';
import { modelInfo } from './catalog-view';
import { ModelError } from './model-error';
import { modelFiles, scanModelState } from './model-files';
import { ModelManager } from './model-manager';

export type LanguagePackPaths = { conditioned: string; languageId: string };

export interface LanguagePackFiles {
  paths(): Promise<LanguagePackPaths | null>;
}

export interface LanguagePack extends LanguagePackFiles {
  view(): LanguagePackView;
  download(): Promise<void>;
  onChange(listener: (view: LanguagePackView) => void): () => void;
}

type PackModels = Pick<ModelManager, 'states' | 'download' | 'verify' | 'onChange'>;

export type LanguagePackDeps = {
  dir: string;
  conditioned: CatalogEntry;
  languageId: CatalogEntry;
  models: PackModels;
  requiredRamBytes: number;
  totalMemory: () => number;
  settings: Pick<SettingsStore, 'get' | 'update'>;
  logger: Logger;
  fetchImpl?: typeof fetch;
};

export function languagePackMemory(models: readonly CatalogEntry[], conditioned: CatalogEntry, languageId: CatalogEntry): number {
  const companions = models.filter((entry) => entry.languageHint !== 'required').map((entry) => entry.minRamBytes);
  return conditioned.minRamBytes + languageId.minRamBytes + Math.max(0, ...companions);
}

class ModelLanguagePack implements LanguagePack {
  private readonly identifier: ModelManager;

  constructor(private readonly deps: LanguagePackDeps) {
    const { dir, languageId, settings, logger, fetchImpl } = deps;
    this.identifier = new ModelManager({ dir, catalog: [languageId], settings, warmUp: () => Promise.resolve(), logger, ...(fetchImpl === undefined ? {} : { fetchImpl }) });
  }

  view(): LanguagePackView {
    const { conditioned, languageId, requiredRamBytes } = this.deps;
    return {
      conditioned: this.part(conditioned, this.deps.models.states()),
      languageId: this.part(languageId, this.identifier.states()),
      requiredRamBytes,
      enoughMemory: this.enoughMemory(),
    };
  }

  async download(): Promise<void> {
    if (!this.enoughMemory()) {
      throw new ModelError('not-ready', 'This computer does not have enough memory for the language pack');
    }
    await this.identifier.download(this.deps.languageId.id);
    await this.deps.models.download(this.deps.conditioned.id);
  }

  async paths(): Promise<LanguagePackPaths | null> {
    const { dir, conditioned, languageId } = this.deps;
    const [conditionedCheck, languageIdCheck] = await Promise.all([this.deps.models.verify(conditioned.id), this.identifier.verify(languageId.id)]);
    if (conditionedCheck !== 'ok' || languageIdCheck !== 'ok') {
      return null;
    }
    return { conditioned: modelFiles(dir, conditioned).model, languageId: modelFiles(dir, languageId).model };
  }

  onChange(listener: (view: LanguagePackView) => void): () => void {
    const notify = (): void => listener(this.view());
    const unsubscribers = [this.deps.models.onChange(notify), this.identifier.onChange(notify)];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }

  private enoughMemory(): boolean {
    return this.deps.totalMemory() >= this.deps.requiredRamBytes;
  }

  private part(entry: CatalogEntry, states: readonly ModelState[]): AuxiliaryModelView {
    const state = states.find((candidate) => candidate.id === entry.id) ?? scanModelState(entry, modelFiles(this.deps.dir, entry));
    return { model: modelInfo(entry), state };
  }
}

export function createLanguagePack(deps: LanguagePackDeps): LanguagePack {
  return new ModelLanguagePack(deps);
}
