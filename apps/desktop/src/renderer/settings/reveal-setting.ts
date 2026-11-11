import { revealSection } from '../components/use-reveal-section';
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

export function revealSetting(id: SettingId): void {
  const row = document.querySelector<HTMLElement>(`[data-setting="${id}"]`);
  const group = settingGroup(id);
  if (row === null && group !== null) {
    revealSection(group);
    return;
  }
  if (row === null) {
    return;
  }
  row.scrollIntoView({ block: 'center' });
  flash(row);
  focusTarget(row).focus({ preventScroll: true });
}
