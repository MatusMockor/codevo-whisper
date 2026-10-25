import { systemPreferences } from 'electron';
import type { MicrophoneAccess } from './permissions-service';

const MEDIA_ACCESS_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['darwin', 'win32']);

function hasMediaAccessApi(): boolean {
  return MEDIA_ACCESS_PLATFORMS.has(process.platform);
}

export const electronMicrophoneAccess: MicrophoneAccess = {
  status: () => (hasMediaAccessApi() ? systemPreferences.getMediaAccessStatus('microphone') : 'granted'),
  ask: () => (process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : Promise.resolve(true)),
};
