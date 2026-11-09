import type { PairingNotice as Notice } from './pairing-notice';
import { EngineSwitchError } from '../settings/EngineSwitchError';
import { useEngineSwitch } from '../settings/use-engine-switch';
import { saveSettings } from '../settings/use-settings';

export function PairingNotice({ notice, onDismiss }: { notice: Notice | null; onDismiss: (deviceId: string) => void }) {
  const engineSwitch = useEngineSwitch();
  if (notice === null) {
    return null;
  }
  if (notice.kind === 'switched') {
    return (
      <div className="card srv-notice pairing-notice" role="status">
        <p>{notice.message}</p>
        <div className="row-btns">
          <button
            type="button"
            className="btn"
            onClick={() => {
              onDismiss(notice.deviceId);
              saveSettings({ engineOrder: notice.previous });
            }}
          >
            Vrátiť späť
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="card srv-notice pairing-notice" role="status">
      <p>{notice.message}</p>
      <div className="row-btns">
        <button type="button" className="btn primary" onClick={() => engineSwitch.prefer('server')}>
          Nastaviť ako hlavný prepis
        </button>
        <button type="button" className="btn ghost" onClick={() => onDismiss(notice.deviceId)}>
          Ponechať lokálne
        </button>
      </div>
      <EngineSwitchError message={engineSwitch.failure} />
    </div>
  );
}
