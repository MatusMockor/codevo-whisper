import { useId, useState } from 'react';
import { hotkeyRecordMessage, type HotkeyRecordProblem } from '../settings/hotkey-record-message';
import { HOTKEY_RECORDING } from './activity-gate';

const DICTATION_NOTE = navigator.userAgent.includes('Linux') ? 'Stlačte skratku a uvoľnite všetky klávesy. Po zmene X11 alebo Waylandu ju nahrajte znova. Ctrl+Super+V je vyhradené.' : 'Stlačte skratku a uvoľnite všetky klávesy. Esc zruší záznam. Kombinácie s bežným klávesom vyžadujú povolenie Prístupnosť.';

type HotkeyRecorderProps<T extends object> = { label: string | null; labelledBy: string; note?: string; record: () => Promise<T | HotkeyRecordProblem>; onRecorded: (value: T) => void };

export function HotkeyRecorder<T extends object>({ label, labelledBy, note = DICTATION_NOTE, record: recordKeys, onRecorded }: HotkeyRecorderProps<T>) {
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const currentId = useId();
  const helpId = useId();

  function record(): void {
    if (recording) {
      return;
    }
    const end = HOTKEY_RECORDING.begin();
    setRecording(true);
    setMessage(null);
    recordKeys()
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
      .finally(() => {
        end();
        setRecording(false);
      });
  }

  return (
    <div className="hk-wrap">
      <button type="button" className="hk" data-rec={recording} aria-labelledby={`${labelledBy} ${currentId}`} aria-busy={recording} aria-describedby={helpId} onClick={record}>
        <span id={currentId}>{recording ? 'Stlačte novú skratku…' : (label ?? 'Nenastavená')}</span>
        <small>{label === null ? 'Nastaviť' : 'Zmeniť'}</small>
      </button>
      <p id={helpId} className="field-note">{note}</p>
      {message !== null && (
        <p className="field-note warn" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
