import type { Settings } from '../../shared/settings';
import { LockedTargetLostError, type AppTarget, type InputHelper, type RefocusResult } from '../helper/input-helper';
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

  insert(text: string, target: AppTarget | null, options?: TextSpacing, lock?: string): Promise<InsertionOutcome> {
    return this.queue.run(() => this.insertInto(sanitizeInsertionText(text, options), target, lock));
  }

  pasteLast(): Promise<PasteLastOutcome> {
    return this.queue.run(() => this.pasteLastTranscript());
  }

  copyLast(): Promise<CopyLastOutcome> {
    return this.queue.run(() => this.copyLastTranscript());
  }

  private async insertInto(text: string, target: AppTarget | null, lock: string | undefined): Promise<InsertionOutcome> {
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
    return lock === undefined ? this.insertAutomatic(text, target, output) : this.insertLocked(text, target, output, lock);
  }

  private async insertAutomatic(text: string, target: AppTarget | null, output: OutputSettings, captureId?: string): Promise<InsertionOutcome> {
    const checked = await this.checkedDelivery(text, target, output, 'automatic', captureId);
    if (checked !== null) return checked;
    if (!isSameTarget(target, await this.helper.frontmost())) {
      return 'blocked-focus-changed';
    }
    return this.deliver(text, target, output, captureId);
  }

  private async insertLocked(text: string, target: AppTarget | null, output: OutputSettings, lock: string): Promise<InsertionOutcome> {
    const refocus = await this.helper.refocusTarget(lock).catch((error: unknown): RefocusResult => {
      this.logger.error('The locked target could not be refocused', error);
      return 'failed';
    });
    try {
      if (refocus === 'failed') return 'blocked-focus-changed';
      if (refocus === 'in-place') return await this.insertAutomatic(text, target, output, lock);
      const outcome = await this.insertAutomatic(text, target, { ...output, autoSubmit: 'off' }, lock);
      return (outcome === 'pasted' || outcome === 'typed') && output.autoSubmit !== 'off' ? 'delivered-submit-blocked' : outcome;
    } catch (error) {
      if (error instanceof LockedTargetLostError) return 'blocked-focus-changed';
      throw error;
    } finally {
      if (refocus !== 'in-place') await this.returnFocus(lock);
    }
  }

  private async returnFocus(lock: string): Promise<void> {
    try {
      if (!(await this.helper.returnFocus(lock))) this.logger.error('Focus could not be returned after the locked insertion', undefined);
    } catch (error) {
      this.logger.error('Focus could not be returned after the locked insertion', error);
    }
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

  private async checkedDelivery(text: string, expected: AppTarget | null, output: OutputSettings, intent: 'automatic' | 'replay', captureId?: string): Promise<InsertionOutcome | null> {
    const decision = await this.helper.checkDelivery({ expected, intent, shortcut: output.linuxPasteShortcut, ...(captureId === undefined ? {} : { captureId }) });
    switch (decision.kind) {
      case 'legacy': return null;
      case 'blocked': {
        const outcomes = { 'focus-changed': 'blocked-focus-changed', 'protected-input': 'blocked-secure-input', 'modifiers-held': 'blocked-modifiers-held' } as const;
        return outcomes[decision.reason];
      }
      case 'copy': return this.copy(text, output.insertion === 'type' ? 'copied-unsupported-output' : `copied-${decision.reason}`);
      case 'allowed': {
        if (output.insertion === 'type') return this.copy(text, 'copied-unsupported-output');
        const outcome = await this.paste(text, output, captureId);
        return outcome === 'pasted' ? this.submitAfterDelivery(outcome, decision.target, output, captureId) : outcome;
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

  private async deliver(text: string, target: AppTarget | null, output: OutputSettings, captureId?: string): Promise<InsertionOutcome> {
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
        await this.helper.typeText(text, captureId);
      } catch (error) {
        if (error instanceof LockedTargetLostError) throw error;
        this.logger.error('Direct typing failed; text may have been partially delivered', error);
        return output.clipboardPolicy === 'leave' ? 'copied-type-failed' : 'failed-type';
      }
      return this.submitAfterDelivery('typed', target, output, captureId);
    }
    const outcome = await this.paste(text, output, captureId);
    return outcome === 'pasted' ? this.submitAfterDelivery(outcome, target, output, captureId) : outcome;
  }

  private async copy(text: string, outcome: CopyOutcome): Promise<InsertionOutcome> {
    if (!(await this.writeClipboard(text))) {
      return 'failed-clipboard-write';
    }
    return outcome;
  }

  private async paste(text: string, output: OutputSettings, captureId?: string): Promise<InsertionOutcome> {
    if (!(await writeClipboardOrRestore(this.helper, text, this.logger, { kind: 'paste', policy: output.clipboardPolicy }, captureId))) {
      return 'failed-clipboard-write';
    }
    try {
      await this.helper.paste(captureId);
    } catch (error) {
      if (error instanceof LockedTargetLostError) {
        await this.helper.restoreSavedClipboard().catch((restoreError: unknown) => {
          this.logger.error('The clipboard could not be restored after the locked paste was refused', restoreError);
        });
        throw error;
      }
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

  private async submitAfterDelivery(delivered: 'typed' | 'pasted', target: AppTarget | null, output: OutputSettings, captureId?: string): Promise<InsertionOutcome> {
    if (output.autoSubmit === 'off') return delivered;
    try {
      if (target === null || !isSameTarget(target, await this.helper.frontmost())) return 'delivered-submit-blocked';
      if (await this.helper.secureInput()) return 'delivered-submit-blocked';
      if ((await this.helper.focusedElement()).editable !== true) return 'delivered-submit-blocked';
      const flags = await this.helper.modifierFlags();
      if (flags.control || flags.command || flags.option || flags.shift) return 'delivered-submit-blocked';
      if (!isSameTarget(target, await this.helper.frontmost())) return 'delivered-submit-blocked';
      await this.helper.submit(output.autoSubmit, captureId);
      return delivered;
    } catch (error) {
      if (error instanceof LockedTargetLostError) return 'delivered-submit-blocked';
      this.logger.error('Text was delivered but automatic submit could not be confirmed', error);
      return 'delivered-submit-failed';
    }
  }

  private writeClipboard(text: string): Promise<boolean> {
    return writeClipboardOrRestore(this.helper, text, this.logger);
  }
}
