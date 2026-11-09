export const SETTINGS_SECTIONS = ['local-model'] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function settingsSectionAnchor(section: SettingsSection): string {
  return `settings-${section}`;
}
