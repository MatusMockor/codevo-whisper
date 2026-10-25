import { systemPreferences } from 'electron';

const MEDIA_ACCESS_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['darwin', 'win32']);

export function electronMicrophoneAccess(): string {
  if (!MEDIA_ACCESS_PLATFORMS.has(process.platform)) {
    return 'granted';
  }
  return systemPreferences.getMediaAccessStatus('microphone');
}
