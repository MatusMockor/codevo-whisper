import { useServer } from '../server/use-server';
import { useSettings } from '../settings/use-settings';
import { privacyZones, UNKNOWN_ZONES, type PrivacyZones } from './privacy-zones';

export function usePrivacyZones(): PrivacyZones {
  const settings = useSettings();
  const server = useServer();
  if (settings.kind !== 'ready' || server.kind !== 'ready') {
    return UNKNOWN_ZONES;
  }
  return privacyZones(settings.value, server.value.server);
}
