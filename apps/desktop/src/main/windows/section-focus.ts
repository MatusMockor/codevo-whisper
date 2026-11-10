import type { PageId } from '../../shared/pages';
import { sectionPage, type SectionId } from '../../shared/section-focus';
import type { MainWindowEvents } from './main-window-controller';

export type SectionWindow = Pick<MainWindowEvents, 'send'> & { open(page?: PageId): void };

export class SectionFocus {
  private pending: SectionId | null = null;

  constructor(private readonly window: SectionWindow) {}

  reveal(section: SectionId): void {
    this.pending = section;
    this.window.open(sectionPage(section));
    this.window.send('section-focus-requested', section);
  }

  take(): SectionId | null {
    const section = this.pending;
    this.pending = null;
    return section;
  }
}
