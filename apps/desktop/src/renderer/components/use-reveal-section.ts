import { useEffect } from 'react';
import type { SectionId } from '../../shared/section-focus';
import type { NavTarget } from '../navigation';
import type { SettingsGroupId } from '../settings/settings-catalog';

export function revealSection(section: SectionId | SettingsGroupId): void {
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
    revealSection(target.section);
  }, [target, ready]);
}
