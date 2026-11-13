import type { ModelCatalogView } from '../../shared/models';
import type { LanguagePack } from '../models/language-pack';
import type { ModelActions } from '../models/model-actions';
import type { ModelManager } from '../models/model-manager';
import type { HandlerGroup } from './invoke-handlers';
import { validateModelId } from './validate';
import { withoutArguments } from './without-arguments';

export type ModelHandlerDeps = {
  catalog: ModelCatalogView;
  models: Pick<ModelManager, 'states'>;
  actions: Pick<ModelActions, 'download' | 'pause' | 'delete' | 'activate' | 'useExisting'>;
  languagePack: Pick<LanguagePack, 'view' | 'download'>;
  pickModelFile: () => Promise<string | null>;
};

export function modelHandlers({ catalog, models, actions, languagePack, pickModelFile }: ModelHandlerDeps): HandlerGroup<
  'getModelCatalog' | 'getModelStates' | 'downloadModel' | 'pauseModel' | 'deleteModel' | 'activateModel' | 'useExistingModel' | 'getLanguagePack' | 'downloadLanguagePack'
> {
  return {
    getModelCatalog: () => Promise.resolve(catalog),
    getModelStates: () => Promise.resolve(models.states()),
    downloadModel: (id) => actions.download(validateModelId(id)),
    pauseModel: (id) => Promise.resolve(actions.pause(validateModelId(id))),
    deleteModel: (id) => actions.delete(validateModelId(id)),
    activateModel: (id) => actions.activate(validateModelId(id)),
    useExistingModel: withoutArguments(async () => {
      const file = await pickModelFile();
      return file === null ? null : actions.useExisting(file);
    }),
    getLanguagePack: withoutArguments(() => languagePack.view()),
    downloadLanguagePack: withoutArguments(() => languagePack.download()),
  };
}
