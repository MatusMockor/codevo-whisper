import type { EngineRouting } from '../engines/engine-routing';
import type { HandlerGroup } from './invoke-handlers';
import { validateEngineId } from './validate';

export type EngineHandlerDeps = { routing: Pick<EngineRouting, 'prefer'> };

export function engineHandlers({ routing }: EngineHandlerDeps): HandlerGroup<'preferEngine'> {
  return {
    preferEngine: async (...args) => await routing.prefer(validateEngineId(args)),
  };
}
