import { useServer } from '../server/use-server';
import { useSettings } from '../settings/use-settings';
import { privacyView, privacyViewWithoutServer, UNKNOWN_PRIVACY, type PrivacyView } from './privacy-zones';

export function usePrivacyView(): PrivacyView {
  const settings = useSettings();
  const server = useServer();
  if (settings.kind !== 'ready') {
    return UNKNOWN_PRIVACY;
  }
  if (server.kind !== 'ready') {
    return privacyViewWithoutServer(settings.value);
  }
  return privacyView(settings.value, server.value.server);
}
