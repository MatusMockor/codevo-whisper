import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import type { DiarizerView, ModelState } from '../../shared/models';
import type { CatalogEntry } from './catalog-entry';
import { modelInfo } from './catalog-view';
import { modelFiles, scanModelState } from './model-files';
import { ModelManager } from './model-manager';

export type Diarizer = {
  view(): DiarizerView;
  download(): Promise<void>;
  pause(): void;
  delete(): Promise<void>;
  modelPath(): Promise<string | null>;
  onChange(listener: (view: DiarizerView) => void): () => void;
};

export type DiarizerDeps = { dir: string; entry: CatalogEntry; settings: Pick<SettingsStore, 'get' | 'update'>; logger: Logger; fetchImpl?: typeof fetch };

export function createDiarizer({ dir, entry, settings, logger, fetchImpl }: DiarizerDeps): Diarizer {
  const manager = new ModelManager({ dir, catalog: [entry], settings, warmUp: () => Promise.resolve(), logger, ...(fetchImpl === undefined ? {} : { fetchImpl }) });
  const files = modelFiles(dir, entry);
  const model = modelInfo(entry);
  const view = (states: readonly ModelState[]): DiarizerView => ({ model, state: states[0] ?? scanModelState(entry, files) });
  return {
    view: () => view(manager.states()),
    download: () => manager.download(entry.id),
    pause: () => manager.pause(entry.id),
    delete: () => manager.delete(entry.id),
    modelPath: async () => ((await manager.verify(entry.id)) === 'ok' ? files.model : null),
    onChange: (listener) => manager.onChange((states) => listener(view(states))),
  };
}
