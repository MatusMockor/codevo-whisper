import type { HandlerGroup } from './invoke-handlers';
import { withoutArguments } from './without-arguments';

export type AppHandlerDeps = { dataFolder: () => string };

export function appHandlers({ dataFolder }: AppHandlerDeps): HandlerGroup<'getDataFolder'> {
  return { getDataFolder: withoutArguments(dataFolder) };
}
