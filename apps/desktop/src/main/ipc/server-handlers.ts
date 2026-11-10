import type { ServerService } from '../remote/server-service';
import type { HandlerGroup } from './invoke-handlers';
import { validateEnabled, validatePairingToken } from './validate';
import { withoutArguments } from './without-arguments';

export type ServerHandlerDeps = { server: Pick<ServerService, 'view' | 'pair' | 'cancelPairing' | 'check' | 'disconnect' | 'setEnabled'> };

export function serverHandlers({ server }: ServerHandlerDeps): HandlerGroup<'getServer' | 'pairServer' | 'cancelServerPairing' | 'checkServer' | 'disconnectServer' | 'setServerEnabled'> {
  return {
    getServer: withoutArguments(() => server.view()),
    pairServer: (token) =>
      new Promise<void>((resolve) => {
        server.pair(validatePairingToken(token));
        resolve();
      }),
    cancelServerPairing: withoutArguments(() => server.cancelPairing()),
    checkServer: withoutArguments(() => server.check()),
    disconnectServer: withoutArguments(() => server.disconnect()),
    setServerEnabled: (...args) => server.setEnabled(validateEnabled(args)),
  };
}
