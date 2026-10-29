import { isHistoryEntryId, isHistoryPolicy } from '../history/history-file';
import type { HistoryStore } from '../history/history-store';
import type { HandlerGroup } from './invoke-handlers';
import { IpcValidationError, rejectArguments } from './validate';
import { withoutArguments } from './without-arguments';

export type HistoryHandlerDeps = { history: Pick<HistoryStore, 'view' | 'configure' | 'deleteEntry' | 'clear'> };

export function historyHandlers({ history }: HistoryHandlerDeps): HandlerGroup<'getHistory' | 'configureHistory' | 'deleteHistoryEntry' | 'clearHistory'> {
  return {
    getHistory: withoutArguments(() => history.view()),
    configureHistory: async (policy, ...extra) => {
      rejectArguments(extra);
      if (!isHistoryPolicy(policy)) throw new IpcValidationError('Invalid history policy');
      await history.configure(policy);
    },
    deleteHistoryEntry: async (id, ...extra) => {
      rejectArguments(extra);
      if (!isHistoryEntryId(id)) throw new IpcValidationError('Invalid history entry id');
      await history.deleteEntry(id);
    },
    clearHistory: withoutArguments(() => history.clear()),
  };
}
