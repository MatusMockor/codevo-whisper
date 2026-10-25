import type { UpdateService } from '../updates/update-service';
import { RELEASES_URL } from '../../shared/updates';
import type { HandlerGroup } from './invoke-handlers';
import { rejectArguments } from './validate';

export type UpdateHandlerDeps = {
  updates: Pick<UpdateService, 'status' | 'check' | 'install'>;
  openUpdateUrl: (url: string) => Promise<void>;
};

function withoutArguments<T>(run: () => T | Promise<T>): (...args: unknown[]) => Promise<T> {
  return (...args) =>
    new Promise<T>((resolve) => {
      rejectArguments(args);
      resolve(run());
    });
}

export function updateHandlers({ updates, openUpdateUrl }: UpdateHandlerDeps): HandlerGroup<'getUpdateStatus' | 'checkForUpdates' | 'installUpdate' | 'openUpdateDownload'> {
  return {
    getUpdateStatus: withoutArguments(() => updates.status()),
    checkForUpdates: withoutArguments(() => updates.check()),
    installUpdate: withoutArguments(() => updates.install()),
    openUpdateDownload: withoutArguments(() => openUpdateUrl(RELEASES_URL)),
  };
}
