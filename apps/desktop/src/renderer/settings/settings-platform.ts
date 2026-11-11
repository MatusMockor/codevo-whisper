import type { SettingsPlatform } from './settings-catalog';

export const SETTINGS_PLATFORM: SettingsPlatform = navigator.userAgent.includes('Linux') ? 'linux' : 'mac';
