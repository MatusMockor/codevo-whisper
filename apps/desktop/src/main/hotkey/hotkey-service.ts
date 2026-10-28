import { sameHotkey, type HotkeyBinding, type HotkeyEvent } from '../../shared/hotkey';
import type { InputHelper } from '../helper/input-helper';
import { Listeners } from '../helper/listeners';
import { consoleLogger, type Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import type { DictationMode, Settings } from '../../shared/settings';
import type { PowerEvents } from './power-events';
import { ResetGuard, type ResetReason } from './reset-guard';

export type StopReason = 'released' | 'toggled' | 'cancelled' | ResetReason;

type HotkeyState = { kind: 'idle' } | { kind: 'held' } | { kind: 'smart-pressed'; pressedAt: number } | { kind: 'latched' };

export class HotkeyService {
  private readonly guard: ResetGuard;
  private readonly starts: Listeners<void>;
  private readonly stops: Listeners<StopReason>;
  private state: HotkeyState = { kind: 'idle' };
  private paused = false;
  private permitted = false;
  private configuration = 0;
  private disposed = false;
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
      helper.onHotkey((event) => this.handleHotkey(event)),
      helper.onInputLost((reason) => {
        if (reason === 'tap-error' || reason === 'helper-died') {
          this.configuration += 1;
          this.permitted = false;
        }
        if (reason === 'helper-restarted') this.reconfigure();
      }),
      settings.onChange((next, previous) => this.handleSettings(next, previous)),
    ];
  }

  async start(): Promise<void> {
    if (this.disposed) return;
    const configuration = ++this.configuration;
    this.permitted = false;
    const permissions = await this.helper.permissions();
    if (configuration !== this.configuration) return;
    const hotkey = this.settings.get().hotkey;
    if (!permissions.listen || (hotkey?.kind === 'key' && !permissions.accessibility)) {
      this.finish('cancelled');
      await this.helper.listen(null);
      this.logger.error(!permissions.listen ? 'Input Monitoring is not granted, the hotkey stays idle' : 'Accessibility is not granted, the combination stays idle', permissions);
      return;
    }
    const binding: HotkeyBinding | null = hotkey === null ? null : hotkey.kind === 'key'
      ? { kind: 'key', keycode: hotkey.keycode, modifiers: hotkey.modifiers }
      : { kind: 'modifiers', keycodes: hotkey.keycodes };
    await this.helper.listen(this.paused ? null : binding, () => {
      if (configuration === this.configuration && !this.disposed) this.permitted = true;
    });
  }

  isArmed(): boolean {
    return this.permitted;
  }

  onStart(listener: () => void): () => void {
    return this.starts.add(listener);
  }

  onStop(listener: (reason: StopReason) => void): () => void {
    return this.stops.add(listener);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.finish('cancelled');
    this.reconfigure();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.reconfigure();
  }

  stopForLimit(): void {
    this.finish('max-duration');
  }

  cancel(): void {
    this.finish('cancelled');
  }

  dispose(): void {
    this.disposed = true;
    this.configuration += 1;
    this.finish('cancelled');
    this.permitted = false;
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }

  private handleHotkey(event: HotkeyEvent): void {
    const { hotkey, mode } = this.settings.get();
    if (this.paused || !this.permitted || hotkey === null) {
      return;
    }
    if (this.state.kind !== 'idle' && this.guard.expired()) {
      this.finish('max-duration');
      return;
    }
    if (event.phase === 'up') {
      this.handleUp(event.ts);
      return;
    }
    this.handleDown(mode, event.ts);
  }

  private handleDown(mode: DictationMode, pressedAt: number): void {
    if (this.state.kind === 'idle') {
      switch (mode) {
        case 'hold':
          this.begin({ kind: 'held' });
          return;
        case 'toggle':
          this.begin({ kind: 'latched' });
          return;
        case 'smart':
          this.begin({ kind: 'smart-pressed', pressedAt });
          return;
      }
    }
    if (this.state.kind === 'latched') {
      this.finish('toggled');
    }
  }

  private handleUp(releasedAt: number): void {
    if (this.state.kind === 'held') {
      this.finish('released');
      return;
    }
    if (this.state.kind !== 'smart-pressed') {
      return;
    }
    if (releasedAt - this.state.pressedAt < 300) {
      this.state = { kind: 'latched' };
      return;
    }
    this.finish('released');
  }

  private begin(nextState: Exclude<HotkeyState, { kind: 'idle' }>): void {
    this.state = nextState;
    this.guard.arm((reason) => this.finish(reason));
    this.starts.emit();
  }

  private finish(reason: StopReason): void {
    if (this.state.kind === 'idle') {
      return;
    }
    this.state = { kind: 'idle' };
    this.guard.disarm();
    this.stops.emit(reason);
  }

  private handleSettings(next: Settings, previous: Settings): void {
    const keyChanged = !sameHotkey(next.hotkey, previous.hotkey);
    if (!keyChanged && next.mode === previous.mode) {
      return;
    }
    this.finish('cancelled');
    if (!keyChanged) {
      return;
    }
    this.reconfigure();
  }

  private reconfigure(): void {
    void this.start().catch((error: unknown) => {
      this.logger.error('Hotkey could not listen to the new key', error);
    });
  }
}
