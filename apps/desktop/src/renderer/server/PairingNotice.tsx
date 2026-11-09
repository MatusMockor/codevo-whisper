import type { PairingNotice as Notice } from './pairing-notice';
import { preferEngine } from '../settings/prefer-engine';
import { saveSettings } from '../settings/use-settings';

export function PairingNotice({ notice, onDismiss }: { notice: Notice | null; onDismiss: (deviceId: string) => void }) {
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
        <button type="button" className="btn primary" onClick={() => preferEngine('server')}>
          Nastaviť ako hlavný prepis
        </button>
        <button type="button" className="btn ghost" onClick={() => onDismiss(notice.deviceId)}>
          Ponechať lokálne
        </button>
      </div>
    </div>
  );
}
