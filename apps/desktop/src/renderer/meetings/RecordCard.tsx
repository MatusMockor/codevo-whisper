import { useState } from 'react';
import type { MeetingSummary } from '../../shared/meetings';
import { formatClock, systemAudioLabel } from './meeting-copy';
import { useNow } from './use-meetings';

type RecordCardProps = { recording: MeetingSummary | null; modelReady: boolean | null; onOpenSettings: () => void };

const HEADPHONES_TIP = 'Tip: použite slúchadlá. Bez nich mikrofón zachytí aj hlas ostatných z reproduktorov a v prepise sa zopakuje.';


export function RecordCard({ recording, modelReady, onOpenSettings }: RecordCardProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(recording !== null);

  function run(command: () => Promise<unknown>, failure: string): void {
    setPending(true);
    setError(null);
    command().then(
      () => setPending(false),
      (caught: unknown) => {
        console.error('The meeting command failed', caught);
        setPending(false);
        setError(failure);
      },
    );
  }

  if (modelReady === false && recording === null) {
    return (
      <div className="card meeting-record">
        <h2>Nové stretnutie</h2>
        <p className="srv-text">Stretnutia sa prepisujú iba lokálnym modelom na tomto počítači. Najprv si v Nastaveniach stiahnite a vyberte lokálny model, potom tu spustíte nahrávanie.</p>
        <div className="row-btns">
          <button type="button" className="btn" onClick={onOpenSettings}>
            Otvoriť Nastavenia
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card meeting-record" aria-busy={pending}>
      <div className="last-top">
        <h2>{recording === null ? 'Nové stretnutie' : 'Nahráva sa stretnutie'}</h2>
        {recording !== null && (
          <span className="pill warn" role="timer" aria-label="Dĺžka nahrávania">
            {formatClock(Math.max(0, now - recording.startedAt))}
          </span>
        )}
      </div>
      {recording === null ? (
        <p className="srv-text">Nahrá mikrofón a zvuk systému ako dve stopy, bez časového limitu. Po zastavení sa stretnutie prepíše lokálne a ostane na tomto počítači.</p>
      ) : (
        <ul className="meeting-tracks" aria-label="Nahrávané stopy">
          <li>Mikrofón: nahráva sa</li>
          <li>
            Zvuk systému: {systemAudioLabel(recording.systemAudio)}
            {recording.systemAudioNote !== null && <span className="field-note">{recording.systemAudioNote}</span>}
          </li>
        </ul>
      )}
      <div className="row-btns">
        {recording === null ? (
          <button type="button" className="btn primary" disabled={pending || modelReady === null} onClick={() => run(() => window.codevo.startMeeting(), 'Nahrávanie sa nepodarilo spustiť. Skontrolujte mikrofón a lokálny model v Nastaveniach.')}>
            Začať nahrávanie
          </button>
        ) : (
          <button type="button" className="btn danger" disabled={pending} onClick={() => run(() => window.codevo.stopMeeting(), 'Nahrávanie sa nepodarilo zastaviť. Skúste to znova.')}>
            Zastaviť a prepísať
          </button>
        )}
      </div>
      {error !== null && (
        <p className="load-error" role="alert">
          {error}
        </p>
      )}
      <p className="note">{HEADPHONES_TIP}</p>
    </div>
  );
}
