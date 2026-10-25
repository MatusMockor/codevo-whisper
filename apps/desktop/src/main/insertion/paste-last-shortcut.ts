import type { InputHelper } from '../helper/input-helper';
import type { Logger } from '../logging/logger';
import type { InsertionService } from './insertion-service';

export function bindPasteLastShortcut(
  helper: Pick<InputHelper, 'onShortcut'>,
  insertion: Pick<InsertionService, 'pasteLast'>,
  logger: Logger,
): () => void {
  return helper.onShortcut((name) => {
    if (name !== 'paste-last') {
      return;
    }
    insertion.pasteLast().then(
      (outcome) => logger.info('Paste last transcript', outcome),
      (error: unknown) => logger.error('Paste last transcript failed', error),
    );
  });
}
