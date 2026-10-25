import type { InputHelper, KeyEvent } from '../helper/input-helper';
import { Listeners } from '../helper/listeners';
import { consoleLogger, type Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import type { DictationMode, Settings } from '../../shared/settings';
import type { PowerEvents } from './power-events';
import { ResetGuard, type ResetReason } from './reset-guard';

export type StopReason = 'released' | 'toggled' | 'cancelled' | ResetReason;

export class HotkeyService {
  private readonly guard: ResetGuard;
  private readonly starts: Listeners<void>;
  private readonly stops: Listeners<StopReason>;
  private active = false;
  private paused = false;
  private permitted = false;
  private readonly unsubscribers: Array<() => void>;

  constructor(
    private readonly helper: InputHelper,
    private readonly settings: SettingsStore,
    power: PowerEvents,
    clock: () => number = () => Date.now(),
    private readonly logger: Logger = consoleLogger,
  ) {
    this.guard = new ResetGuard(helper, power, clock);
    this.starts = new Listeners(logger, 'Hotkey start listener failed');
    this.stops = new Listeners(logger, 'Hotkey stop listener failed');
    this.unsubscribers = [
      helper.onKey((event) => this.handleKey(event)),
      settings.onChange((next, previous) => this.handleSettings(next, previous)),
    ];
  }

  async start(): Promise<void> {
    const permissions = await this.helper.permissions();
    if (!permissions.listen) {
      this.logger.error('Input Monitoring is not granted, the hotkey stays idle', permissions);
      return;
    }
    this.permitted = true;
    await this.listen();
  }

  onStart(listener: () => void): () => void {
    return this.starts.add(listener);
  }

  onStop(listener: (reason: StopReason) => void): () => void {
    return this.stops.add(listener);
  }

  pause(): void {
    this.paused = true;
    this.finish('cancelled');
  }

  resume(): void {
    this.paused = false;
  }

  stopForLimit(): void {
    this.finish('max-duration');
  }

  dispose(): void {
    this.finish('cancelled');
    this.permitted = false;
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }

  private handleKey(event: KeyEvent): void {
    const { hotkey, mode } = this.settings.get();
    if (this.paused || hotkey?.keycode !== event.keycode) {
      return;
    }
    if (this.active && this.guard.expired()) {
      this.finish('max-duration');
      return;
    }
    if (event.phase === 'up') {
      this.handleUp(mode);
      return;
    }
    this.handleDown(mode);
  }

  private handleDown(mode: DictationMode): void {
    if (!this.active) {
      this.begin();
      return;
    }
    if (mode === 'toggle') {
      this.finish('toggled');
    }
  }

  private handleUp(mode: DictationMode): void {
    if (mode !== 'hold') {
      return;
    }
    this.finish('released');
  }

  private begin(): void {
    this.active = true;
    this.guard.arm((reason) => this.finish(reason));
    this.starts.emit();
  }

  private finish(reason: StopReason): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.guard.disarm();
    this.stops.emit(reason);
  }

  private handleSettings(next: Settings, previous: Settings): void {
    const keyChanged = next.hotkey?.keycode !== previous.hotkey?.keycode;
    if (!keyChanged && next.mode === previous.mode) {
      return;
    }
    this.finish('cancelled');
    if (!keyChanged) {
      return;
    }
    this.listen().catch((error: unknown) => {
      this.logger.error('Hotkey could not listen to the new key', error);
    });
  }

  private async listen(): Promise<void> {
    if (!this.permitted) {
      return;
    }
    const hotkey = this.settings.get().hotkey;
    await this.helper.listen(hotkey ? [hotkey.keycode] : []);
  }
}
