import { useEffect } from 'react';
import type { SettingsSection } from '../navigation';

export function useRevealSection(section: SettingsSection | null, ready: boolean): void {
  useEffect(() => {
    if (section === null || !ready) {
      return;
    }
    const group = document.querySelector<HTMLElement>(`[data-section="${section}"]`);
    if (group === null) {
      return;
    }
    group.scrollIntoView({ block: 'start' });
    group.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, [section, ready]);
}
