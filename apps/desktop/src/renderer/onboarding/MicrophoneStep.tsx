import type { Live } from '../home/live-value';
import type { MicrophonePermission, PermissionsStatus } from '../../shared/permissions';
import { PermissionRow } from './PermissionRow';

const STATUS_LABELS: Readonly<Record<MicrophonePermission, string>> = {
  granted: 'Povolené',
  denied: 'Zamietnuté',
  'not-determined': 'Zatiaľ nepovolené',
};

function report(error: unknown): void {
  console.error('The microphone permission request failed', error);
}

export function MicrophoneStep({ permissions, refresh }: { permissions: Live<PermissionsStatus>; refresh: () => void }) {
  if (permissions.kind !== 'ready') {
    return null;
  }
  const microphone = permissions.value.microphone;
  const denied = microphone === 'denied';
  return (
    <div className="sbox">
      <PermissionRow
        title="Mikrofón"
        description={denied ? 'Prístup je zamietnutý. Povoľte Codevo Whisper v Nastaveniach systému v časti Mikrofón.' : 'macOS sa opýta, či môže Codevo Whisper používať mikrofón.'}
        granted={microphone === 'granted'}
        statusLabel={STATUS_LABELS[microphone]}
        actionLabel={denied ? 'Otvoriť Nastavenia systému' : 'Povoliť mikrofón'}
        onAction={() => {
          const request = denied ? window.codevo.openPermissionSettings('microphone') : window.codevo.requestPermission('microphone');
          request.then(refresh, report);
        }}
      />
    </div>
  );
}
