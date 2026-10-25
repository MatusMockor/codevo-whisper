import { useEffect, useState } from 'react';
import { liveValueOr, useLiveValue, type Live } from '../home/live-value';
import type { ModelCatalogView, ModelState } from '../../shared/models';

const loadStates = () => window.codevo.getModelStates();

export type Models = { catalog: Live<ModelCatalogView>; states: ModelState[] };

function useCatalog(): Live<ModelCatalogView> {
  const [catalog, setCatalog] = useState<Live<ModelCatalogView>>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    window.codevo.getModelCatalog().then(
      (value) => {
        if (active) {
          setCatalog({ kind: 'ready', value });
        }
      },
      (error: unknown) => {
        console.error('Loading the model catalog failed', error);
        if (active) {
          setCatalog({ kind: 'failed' });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return catalog;
}

export function useModels(): Models {
  const catalog = useCatalog();
  const states = useLiveValue('model-states-changed', loadStates);
  return { catalog, states: liveValueOr(states, []) };
}
