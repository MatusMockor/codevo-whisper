import type { AppTarget, InputHelper } from '../helper/input-helper';
import { consoleLogger, type Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import { writeClipboardOrRestore } from './guarded-clipboard';
import type { LastTranscript } from './last-transcript';
import { waitForShortcutRelease, type Sleep } from './modifier-release';
import { isSameTarget } from './same-target';
import { sanitizeInsertionText } from './sanitize-insertion-text';
import { SerialQueue } from './serial-queue';

export type InsertionOutcome =
  | 'pasted'
  | 'copied-no-text-field'
  | 'copied-by-setting'
  | 'copied-paste-failed'
  | 'blocked-focus-changed'
  | 'blocked-secure-input'
  | 'blocked-modifiers-held'
  | 'failed-clipboard-write'
  | 'nothing-to-insert';

export type PasteLastOutcome = InsertionOutcome | 'no-transcript';

export type CopyLastOutcome = 'copied' | 'no-transcript' | 'failed-clipboard-write';

type CopyOutcome = 'copied-no-text-field' | 'copied-by-setting';

const RESTORE_DELAY_MS = 500;

const delay: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class InsertionService {
  private readonly queue = new SerialQueue();

  constructor(
    private readonly helper: InputHelper,
    private readonly settings: Pick<SettingsStore, 'get'>,
    private readonly lastTranscript: LastTranscript,
    private readonly sleep: Sleep = delay,
    private readonly logger: Logger = consoleLogger,
  ) {}

  insert(text: string, target: AppTarget | null): Promise<InsertionOutcome> {
    return this.queue.run(() => this.insertInto(sanitizeInsertionText(text), target));
  }

  pasteLast(): Promise<PasteLastOutcome> {
    return this.queue.run(() => this.pasteLastTranscript());
  }

  copyLast(): Promise<CopyLastOutcome> {
    return this.queue.run(() => this.copyLastTranscript());
  }

  private async insertInto(text: string, target: AppTarget | null): Promise<InsertionOutcome> {
    if (text === '') {
      return 'nothing-to-insert';
    }
    if (this.copiesBySetting()) {
      return this.copy(text, 'copied-by-setting');
    }
    if (!isSameTarget(target, await this.helper.frontmost())) {
      return 'blocked-focus-changed';
    }
    return this.deliver(text);
  }

  private async pasteLastTranscript(): Promise<PasteLastOutcome> {
    const text = this.lastTranscript.get();
    if (!text) {
      return 'no-transcript';
    }
    if (this.copiesBySetting()) {
      return this.copy(text, 'copied-by-setting');
    }
    if (!(await waitForShortcutRelease(this.helper, this.sleep))) {
      return 'blocked-modifiers-held';
    }
    return this.deliver(text);
  }

  private async copyLastTranscript(): Promise<CopyLastOutcome> {
    const text = this.lastTranscript.get();
    if (!text) {
      return 'no-transcript';
    }
    if (!(await this.writeClipboard(text))) {
      return 'failed-clipboard-write';
    }
    return 'copied';
  }

  private async deliver(text: string): Promise<InsertionOutcome> {
    if (await this.helper.secureInput()) {
      return 'blocked-secure-input';
    }
    const element = await this.helper.focusedElement();
    if (element.editable === false) {
      return this.copy(text, 'copied-no-text-field');
    }
    return this.paste(text);
  }

  private async copy(text: string, outcome: CopyOutcome): Promise<InsertionOutcome> {
    if (!(await this.writeClipboard(text))) {
      return 'failed-clipboard-write';
    }
    return outcome;
  }

  private async paste(text: string): Promise<InsertionOutcome> {
    if (!(await this.writeClipboard(text))) {
      return 'failed-clipboard-write';
    }
    try {
      await this.helper.paste();
    } catch (error) {
      this.logger.error('The paste failed, the transcript stays on the clipboard', error);
      return 'copied-paste-failed';
    }
    await this.sleep(RESTORE_DELAY_MS);
    await this.helper.restoreClipboard(text).catch((error: unknown) => {
      this.logger.error('The clipboard could not be restored after the paste', error);
    });
    return 'pasted';
  }

  private writeClipboard(text: string): Promise<boolean> {
    return writeClipboardOrRestore(this.helper, text, this.logger);
  }

  private copiesBySetting(): boolean {
    return this.settings.get().insertion === 'clipboard';
  }
}
