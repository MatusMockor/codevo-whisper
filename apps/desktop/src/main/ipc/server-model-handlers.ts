import type { ServerModelOperations } from '../remote/server-model-operations';
import type { ServerService } from '../remote/server-service';
import type { HandlerGroup } from './invoke-handlers';
import { validateTranscriptionModelId } from './validate';
import { withoutArguments } from './without-arguments';

export type ServerModelHandlerDeps = { server: Pick<ServerService, 'refreshModels'>; serverModels: Pick<ServerModelOperations, 'run'> };

export function serverModelHandlers({ server, serverModels }: ServerModelHandlerDeps): HandlerGroup<'serverModelDownload' | 'serverModelRemove' | 'serverModelCancel' | 'refreshServerModels'> {
  return {
    serverModelDownload: (...args) => serverModels.run('download', validateTranscriptionModelId(args)),
    serverModelRemove: (...args) => serverModels.run('remove', validateTranscriptionModelId(args)),
    serverModelCancel: (...args) => serverModels.run('cancel', validateTranscriptionModelId(args)),
    refreshServerModels: withoutArguments(() => server.refreshModels()),
  };
}
