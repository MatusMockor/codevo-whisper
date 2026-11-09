import type { PageId } from '../../shared/pages';
import type { SettingsSection } from '../../shared/settings-focus';
import type { MainWindowEvents } from './main-window-controller';

export type SettingsWindow = Pick<MainWindowEvents, 'send'> & { open(page?: PageId): void };

export class SettingsFocus {
  private pending: SettingsSection | null = null;

  constructor(private readonly window: SettingsWindow) {}

  reveal(section: SettingsSection): void {
    this.pending = section;
    this.window.open('settings');
    this.window.send('settings-focus-requested', section);
  }

  take(): SettingsSection | null {
    const section = this.pending;
    this.pending = null;
    return section;
  }
}
