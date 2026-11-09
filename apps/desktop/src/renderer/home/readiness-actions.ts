import type { NavTarget, SettingsSection } from '../navigation';
import { ACTION_MESSAGES, type BannerContent } from './banner-content';

export type ReadinessAction = { id: string; label: string; target: NavTarget; primary: boolean };

type ActionContent = Extract<BannerContent, { kind: 'action' }>;

const SECTION_BY_MESSAGE: ReadonlyMap<string, SettingsSection> = new Map<string, SettingsSection>([
  [ACTION_MESSAGES.hotkey, 'Diktovanie'],
  [ACTION_MESSAGES.model, 'Lokálny model'],
]);

function settingsTarget(message: string): NavTarget {
  const section = SECTION_BY_MESSAGE.get(message);
  if (section === undefined) {
    return { page: 'settings' };
  }
  return { page: 'settings', section };
}

export function readinessActions(content: ActionContent): ReadinessAction[] {
  if (content.target === 'server') {
    return [{ id: 'open-server', label: 'Otvoriť Server', target: { page: 'server' }, primary: true }];
  }
  return [{ id: 'open-settings', label: 'Otvoriť nastavenia', target: settingsTarget(content.message), primary: true }];
}
