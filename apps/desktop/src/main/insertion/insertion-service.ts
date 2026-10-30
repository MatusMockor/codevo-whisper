import type { Settings } from '../../shared/settings';
import type { AppTarget, InputHelper } from '../helper/input-helper';
import { consoleLogger, type Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import { writeClipboardOrRestore } from './guarded-clipboard';
import type { LastTranscript } from './last-transcript';
import { waitForShortcutRelease, type Sleep } from './modifier-release';
import { isSameTarget } from './same-target';
import { sanitizeInsertionText, type TextSpacing } from './sanitize-insertion-text';
import { SerialQueue } from './serial-queue';

export type InsertionOutcome =
  | 'pasted'
  | 'typed'
  | 'delivered-submit-blocked'
  | 'delivered-submit-failed'
  | 'failed-type'
  | 'copied-type-failed'
  | 'copied-no-text-field'
  | 'copied-unverified-target'
  | 'copied-posting-unavailable'
  | 'copied-unsupported-output'
  | 'copied-by-setting'
  | 'copied-paste-failed'
  | 'blocked-focus-changed'
  | 'blocked-secure-input'
  | 'blocked-modifiers-held'
  | 'failed-clipboard-write'
  | 'nothing-to-insert';

export type PasteLastOutcome = InsertionOutcome | 'no-transcript';

export type CopyLastOutcome = 'copied' | 'no-transcript' | 'failed-clipboard-write';

type OutputSettings = Pick<Settings, 'insertion' | 'clipboardPolicy' | 'autoSubmit' | 'linuxPasteShortcut'>;

type CopyOutcome = 'copied-no-text-field' | 'copied-by-setting' | 'copied-unverified-target' | 'copied-posting-unavailable' | 'copied-unsupported-output';

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

  insert(text: string, target: AppTarget | null, options?: TextSpacing): Promise<InsertionOutcome> {
    return this.queue.run(() => this.insertInto(sanitizeInsertionText(text, options), target));
  }

  pasteLast(): Promise<PasteLastOutcome> {
    return this.queue.run(() => this.pasteLastTranscript());
  }

  copyLast(): Promise<CopyLastOutcome> {
    return this.queue.run(() => this.copyLastTranscript());
  }

  private async insertInto(text: string, target: AppTarget | null): Promise<InsertionOutcome> {
    const output = this.settings.get();
    if (text === '') {
      return 'nothing-to-insert';
    }
    if (output.insertion === 'clipboard') {
      return this.copy(text, 'copied-by-setting');
    }
    if (!(await waitForShortcutRelease(this.helper, this.sleep))) {
      return 'blocked-modifiers-held';
    }
    const checked = await this.checkedDelivery(text, target, output, 'automatic');
    if (checked !== null) return checked;
    if (!isSameTarget(target, await this.helper.frontmost())) {
      return 'blocked-focus-changed';
    }
    return this.deliver(text, target, output);
  }

  private async pasteLastTranscript(): Promise<PasteLastOutcome> {
    const output = this.settings.get();
    const text = this.lastTranscript.get();
    if (!text) {
      return 'no-transcript';
    }
    if (output.insertion === 'clipboard') {
      return this.copy(text, 'copied-by-setting');
    }
    if (!(await waitForShortcutRelease(this.helper, this.sleep))) {
      return 'blocked-modifiers-held';
    }
    const checked = await this.checkedDelivery(text, null, output, 'replay');
    if (checked !== null) return checked;
    const target = output.autoSubmit === 'off' ? null : await this.helper.frontmost();
    return this.deliver(text, target, output);
  }

  private async checkedDelivery(text: string, expected: AppTarget | null, output: OutputSettings, intent: 'automatic' | 'replay'): Promise<InsertionOutcome | null> {
    const decision = await this.helper.checkDelivery({ expected, intent, shortcut: output.linuxPasteShortcut });
    switch (decision.kind) {
      case 'legacy': return null;
      case 'blocked': {
        const outcomes = { 'focus-changed': 'blocked-focus-changed', 'protected-input': 'blocked-secure-input', 'modifiers-held': 'blocked-modifiers-held' } as const;
        return outcomes[decision.reason];
      }
      case 'copy': return this.copy(text, output.insertion === 'type' ? 'copied-unsupported-output' : `copied-${decision.reason}`);
      case 'allowed': {
        if (output.insertion === 'type') return this.copy(text, 'copied-unsupported-output');
        const outcome = await this.paste(text, output);
        return outcome === 'pasted' ? this.submitAfterDelivery(outcome, decision.target, output) : outcome;
      }
    }
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

  private async deliver(text: string, target: AppTarget | null, output: OutputSettings): Promise<InsertionOutcome> {
    if (await this.helper.secureInput()) {
      return 'blocked-secure-input';
    }
    const element = await this.helper.focusedElement();
    if (element.editable === false) {
      return this.copy(text, 'copied-no-text-field');
    }
    if (output.insertion === 'type') {
      if (output.clipboardPolicy === 'leave' && !(await this.writeClipboard(text))) {
        return 'failed-clipboard-write';
      }
      try {
        await this.helper.typeText(text);
        return this.submitAfterDelivery('typed', target, output);
      } catch (error) {
        this.logger.error('Direct typing failed; text may have been partially delivered', error);
        return output.clipboardPolicy === 'leave' ? 'copied-type-failed' : 'failed-type';
      }
    }
    const outcome = await this.paste(text, output);
    return outcome === 'pasted' ? this.submitAfterDelivery(outcome, target, output) : outcome;
  }

  private async copy(text: string, outcome: CopyOutcome): Promise<InsertionOutcome> {
    if (!(await this.writeClipboard(text))) {
      return 'failed-clipboard-write';
    }
    return outcome;
  }

  private async paste(text: string, output: OutputSettings): Promise<InsertionOutcome> {
    if (!(await writeClipboardOrRestore(this.helper, text, this.logger, { kind: 'paste', policy: output.clipboardPolicy }))) {
      return 'failed-clipboard-write';
    }
    try {
      await this.helper.paste();
    } catch (error) {
      this.logger.error('The paste failed, the transcript stays on the clipboard', error);
      return 'copied-paste-failed';
    }
    await this.sleep(RESTORE_DELAY_MS);
    if (output.clipboardPolicy === 'restore') {
      await this.helper.restoreClipboard(text).catch((error: unknown) => {
        this.logger.error('The clipboard could not be restored after the paste', error);
      });
    }
    return 'pasted';
  }

  private async submitAfterDelivery(delivered: 'typed' | 'pasted', target: AppTarget | null, output: OutputSettings): Promise<InsertionOutcome> {
    if (output.autoSubmit === 'off') return delivered;
    try {
      if (target === null || !isSameTarget(target, await this.helper.frontmost())) return 'delivered-submit-blocked';
      if (await this.helper.secureInput()) return 'delivered-submit-blocked';
      if ((await this.helper.focusedElement()).editable !== true) return 'delivered-submit-blocked';
      const flags = await this.helper.modifierFlags();
      if (flags.control || flags.command || flags.option || flags.shift) return 'delivered-submit-blocked';
      if (!isSameTarget(target, await this.helper.frontmost())) return 'delivered-submit-blocked';
      await this.helper.submit(output.autoSubmit);
      return delivered;
    } catch (error) {
      this.logger.error('Text was delivered but automatic submit could not be confirmed', error);
      return 'delivered-submit-failed';
    }
  }

  private writeClipboard(text: string): Promise<boolean> {
    return writeClipboardOrRestore(this.helper, text, this.logger);
  }
}
