import { useEffect } from 'react';
import { settingsSectionAnchor, type SettingsSection } from '../../shared/settings-focus';

export function revealSettingsSection(section: SettingsSection): void {
  const element = document.getElementById(settingsSectionAnchor(section));
  if (element === null) {
    return;
  }
  element.scrollIntoView({ block: 'start', behavior: 'smooth' });
  element.focus({ preventScroll: true });
}

function revealRequested(): void {
  window.codevo.takeSettingsFocus().then(
    (section) => {
      if (section === null) {
        return;
      }
      revealSettingsSection(section);
    },
    (error: unknown) => console.error('Reading the requested settings section failed', error),
  );
}

export function useSettingsFocus(rendered: boolean): void {
  useEffect(() => {
    if (!rendered) {
      return;
    }
    revealRequested();
    return window.codevo.on('settings-focus-requested', revealRequested);
  }, [rendered]);
}
