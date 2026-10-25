import type { AppTarget, InputHelper } from '../helper/input-helper';
import type { SettingsStore } from '../settings/settings-store';
import { writeClipboardOrRestore } from './guarded-clipboard';
import type { LastTranscript } from './last-transcript';
import { waitForShortcutRelease, type Sleep } from './modifier-release';
import { isSameTarget } from './same-target';
import { SerialQueue } from './serial-queue';

export type InsertionOutcome =
  | 'pasted'
  | 'copied-no-text-field'
  | 'copied-by-setting'
  | 'blocked-focus-changed'
  | 'blocked-secure-input'
  | 'blocked-modifiers-held'
  | 'failed-clipboard-write';

export type PasteLastOutcome = InsertionOutcome | 'no-transcript';

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
  ) {}

  insert(text: string, target: AppTarget | null): Promise<InsertionOutcome> {
    return this.queue.run(() => this.insertInto(text, target));
  }

  pasteLast(): Promise<PasteLastOutcome> {
    return this.queue.run(() => this.pasteLastTranscript());
  }

  private async insertInto(text: string, target: AppTarget | null): Promise<InsertionOutcome> {
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
    if (!(await writeClipboardOrRestore(this.helper, text))) {
      return 'failed-clipboard-write';
    }
    return outcome;
  }

  private async paste(text: string): Promise<InsertionOutcome> {
    if (!(await writeClipboardOrRestore(this.helper, text))) {
      return 'failed-clipboard-write';
    }
    await this.helper.paste();
    await this.sleep(RESTORE_DELAY_MS);
    await this.helper.restoreClipboard(text);
    return 'pasted';
  }

  private copiesBySetting(): boolean {
    return this.settings.get().insertion === 'clipboard';
  }
}
