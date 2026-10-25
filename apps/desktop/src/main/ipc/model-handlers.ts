import type { ModelCatalogView } from '../../shared/models';
import type { ModelActions } from '../models/model-actions';
import type { ModelManager } from '../models/model-manager';
import type { HandlerGroup } from './invoke-handlers';
import { validateModelId } from './validate';

export type ModelHandlerDeps = {
  catalog: ModelCatalogView;
  models: Pick<ModelManager, 'states'>;
  actions: Pick<ModelActions, 'download' | 'pause' | 'delete' | 'activate'>;
};

export function modelHandlers({ catalog, models, actions }: ModelHandlerDeps): HandlerGroup<'getModelCatalog' | 'getModelStates' | 'downloadModel' | 'pauseModel' | 'deleteModel' | 'activateModel'> {
  return {
    getModelCatalog: () => Promise.resolve(catalog),
    getModelStates: () => Promise.resolve(models.states()),
    downloadModel: (id) => actions.download(validateModelId(id)),
    pauseModel: (id) => Promise.resolve(actions.pause(validateModelId(id))),
    deleteModel: (id) => actions.delete(validateModelId(id)),
    activateModel: (id) => actions.activate(validateModelId(id)),
  };
}
