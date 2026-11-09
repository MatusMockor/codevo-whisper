import { useEffect } from 'react';
import type { SettingsSection } from '../../shared/settings-focus';
import type { NavTarget } from '../navigation';

export function revealSettingsSection(section: SettingsSection): void {
  const group = document.querySelector<HTMLElement>(`[data-section="${section}"]`);
  if (group === null) {
    return;
  }
  group.scrollIntoView({ block: 'start' });
  group.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

export function useRevealSection(target: NavTarget, ready: boolean): void {
  useEffect(() => {
    if (target.section === undefined || !ready) {
      return;
    }
    revealSettingsSection(target.section);
  }, [target, ready]);
}
