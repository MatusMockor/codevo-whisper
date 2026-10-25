import type { ServerService } from '../remote/server-service';
import type { HandlerGroup } from './invoke-handlers';
import { validatePairingToken } from './validate';

export type ServerHandlerDeps = { server: Pick<ServerService, 'view' | 'pair' | 'cancelPairing' | 'check' | 'disconnect'> };

export function serverHandlers({ server }: ServerHandlerDeps): HandlerGroup<'getServer' | 'pairServer' | 'cancelServerPairing' | 'checkServer' | 'disconnectServer'> {
  return {
    getServer: () => server.view(),
    pairServer: (token) => {
      server.pair(validatePairingToken(token));
      return Promise.resolve();
    },
    cancelServerPairing: () => {
      server.cancelPairing();
      return Promise.resolve();
    },
    checkServer: () => server.check(),
    disconnectServer: () => server.disconnect(),
  };
}
