import type { UpdateService } from '../updates/update-service';
import { RELEASES_URL } from '../../shared/updates';
import type { HandlerGroup } from './invoke-handlers';
import { withoutArguments } from './without-arguments';

export type UpdateHandlerDeps = {
  updates: Pick<UpdateService, 'status' | 'check' | 'install'>;
  openUpdateUrl: (url: string) => Promise<void>;
};

export function updateHandlers({ updates, openUpdateUrl }: UpdateHandlerDeps): HandlerGroup<'getUpdateStatus' | 'checkForUpdates' | 'installUpdate' | 'openUpdateDownload'> {
  return {
    getUpdateStatus: withoutArguments(() => updates.status()),
    checkForUpdates: withoutArguments(() => updates.check()),
    installUpdate: withoutArguments(() => updates.install()),
    openUpdateDownload: withoutArguments(() => openUpdateUrl(RELEASES_URL)),
  };
}
