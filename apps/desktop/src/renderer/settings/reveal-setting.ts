import { revealSection } from '../components/use-reveal-section';
import type { NavTarget } from '../navigation';
import { settingGroup, type SettingId } from './settings-catalog';

const FOCUSABLE = 'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)';

function focusTarget(row: HTMLElement): HTMLElement {
  const control = row.querySelector<HTMLElement>(FOCUSABLE);
  if (control !== null) {
    return control;
  }
  row.tabIndex = -1;
  return row;
}

function flash(row: HTMLElement): void {
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
  row.addEventListener('animationend', () => row.classList.remove('flash'), { once: true });
}

export function revealSetting(id: SettingId): boolean {
  const row = document.querySelector<HTMLElement>(`[data-setting="${id}"]`);
  if (row === null) {
    return false;
  }
  row.scrollIntoView({ block: 'center' });
  flash(row);
  focusTarget(row).focus({ preventScroll: true });
  return true;
}

export function revealDestination(target: NavTarget): boolean {
  if (target.setting !== undefined) {
    return revealSetting(target.setting);
  }
  if (target.section !== undefined) {
    return revealSection(target.section);
  }
  return true;
}

export function revealNearestGroup(target: NavTarget): void {
  const group = target.setting === undefined ? null : settingGroup(target.setting);
  if (group === null) {
    return;
  }
  revealSection(group);
}
