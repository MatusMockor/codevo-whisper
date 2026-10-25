import { useId, useState } from 'react';
import type { HotkeySetting } from '../../shared/settings';
import { hotkeyRecordMessage } from '../settings/hotkey-record-message';

type HotkeyRecorderProps = { hotkey: HotkeySetting; labelledBy: string; onRecorded: (hotkey: NonNullable<HotkeySetting>) => void };

export function HotkeyRecorder({ hotkey, labelledBy, onRecorded }: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const currentId = useId();

  function record(): void {
    if (recording) {
      return;
    }
    setRecording(true);
    setMessage(null);
    window.codevo
      .recordHotkey()
      .then(
        (result) => {
          if (typeof result === 'string') {
            setMessage(hotkeyRecordMessage(result));
            return;
          }
          onRecorded(result);
        },
        (error: unknown) => {
          console.error('Recording the hotkey failed', error);
          setMessage(hotkeyRecordMessage('failed'));
        },
      )
      .finally(() => setRecording(false));
  }

  return (
    <div className="hk-wrap">
      <button type="button" className="hk" data-rec={recording} aria-labelledby={`${labelledBy} ${currentId}`} aria-busy={recording} onClick={record}>
        <span id={currentId}>{recording ? 'Stlačte novú skratku…' : (hotkey?.label ?? 'Nenastavená')}</span>
        <small>{hotkey === null ? 'Nastaviť' : 'Zmeniť'}</small>
      </button>
      {message !== null && (
        <p className="field-note warn" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
