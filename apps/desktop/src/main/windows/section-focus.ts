import type { PageId } from '../../shared/pages';
import { focusPage, type FocusRequest, type FocusSetting, type SectionId } from '../../shared/section-focus';
import type { MainWindowEvents } from './main-window-controller';

export type SectionWindow = Pick<MainWindowEvents, 'send'> & { open(page?: PageId): void };

export class SectionFocus {
  private pending: FocusRequest | null = null;

  constructor(private readonly window: SectionWindow) {}

  reveal(section: SectionId): void {
    this.request({ kind: 'section', section });
  }

  revealSetting(setting: FocusSetting): void {
    this.request({ kind: 'setting', setting });
  }

  take(): FocusRequest | null {
    const request = this.pending;
    this.pending = null;
    return request;
  }

  private request(request: FocusRequest): void {
    this.pending = request;
    this.window.open(focusPage(request));
    this.window.send('section-focus-requested', request);
  }
}
