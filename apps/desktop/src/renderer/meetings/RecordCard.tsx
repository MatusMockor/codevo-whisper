import { useId, useState } from 'react';
import { formatClock, type MeetingSummary } from '../../shared/meetings';
import { Glyph } from '../components/Glyph';
import { Led } from '../components/Led';
import type { NavTarget } from '../navigation';
import { systemAudioLabel } from './meeting-copy';
import { DOWNLOAD_MODEL, START_FAILURE_REMEDIES, type MeetingRemedy } from './meeting-remedies';
import { RemedyLinks } from './RemedyLinks';
import { useNow } from './use-meetings';

type RecordCardProps = { recording: MeetingSummary | null; modelReady: boolean | null; onNavigate: (target: NavTarget) => void };

type CommandFailure = { message: string; remedies: readonly MeetingRemedy[] };

const START_FAILURE: CommandFailure = Object.freeze({ message: 'Nahrávanie sa nepodarilo spustiť.', remedies: START_FAILURE_REMEDIES });

const STOP_FAILURE: CommandFailure = Object.freeze({ message: 'Nahrávanie sa nepodarilo zastaviť. Skúste to znova.', remedies: [] });

const HEADPHONES_TIP = 'Použite slúchadlá. Bez nich mikrofón zachytí aj hlas ostatných z reproduktorov a v prepise sa zopakuje.';

function MissingModel({ onNavigate }: { onNavigate: (target: NavTarget) => void }) {
  const id = useId();
  return (
    <section className="last meeting-record" aria-labelledby={id}>
      <div className="last-top">
        <h2 id={id}>Nové stretnutie</h2>
        <Led state="err" />
      </div>
      <p className="rec-text">Stretnutia prepisuje iba lokálny model. Najprv si na stránke Prepis stiahnite a vyberte lokálny model.</p>
      <div className="row-btns">
        <button type="button" className="btn primary" onClick={() => onNavigate(DOWNLOAD_MODEL.target)}>
          {DOWNLOAD_MODEL.label}
        </button>
      </div>
    </section>
  );
}

function Clock({ recording }: { recording: MeetingSummary | null }) {
  const now = useNow(recording !== null);
  if (recording === null) {
    return <p className="rec-clock">{formatClock(0)}</p>;
  }
  return (
    <p className="rec-clock" role="timer" aria-label="Dĺžka nahrávania">
      {formatClock(Math.max(0, now - recording.startedAt))}
    </p>
  );
}

function Tracks({ recording }: { recording: MeetingSummary }) {
  return (
    <ul className="meeting-tracks" aria-label="Nahrávané stopy">
      <li>
        <Glyph name="mic" size="sm" />
        <span>Mikrofón: nahráva sa</span>
      </li>
      <li>
        <Glyph name="laptop" size="sm" />
        <span>
          Zvuk systému: {systemAudioLabel(recording.systemAudio)}
          {recording.systemAudioNote !== null && <span className="field-note">{recording.systemAudioNote}</span>}
        </span>
      </li>
    </ul>
  );
}

export function RecordCard({ recording, modelReady, onNavigate }: RecordCardProps) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<CommandFailure | null>(null);

  function run(command: () => Promise<unknown>, onFailure: CommandFailure): void {
    setPending(true);
    setFailure(null);
    command().then(
      () => setPending(false),
      (caught: unknown) => {
        console.error('The meeting command failed', caught);
        setPending(false);
        setFailure(onFailure);
      },
    );
  }

  if (modelReady === false && recording === null) {
    return <MissingModel onNavigate={onNavigate} />;
  }

  return (
    <section className={recording === null ? 'last meeting-record' : 'last meeting-record live'} aria-labelledby={id} aria-busy={pending}>
      <div className="last-top">
        <h2 id={id}>{recording === null ? 'Nové stretnutie' : 'Nahráva sa stretnutie'}</h2>
        <Led state={recording === null ? 'off' : 'warn'} />
      </div>
      <Clock recording={recording} />
      {recording === null ? <p className="rec-text">Dve stopy, bez časového limitu. Prepis ostane na tomto počítači.</p> : <Tracks recording={recording} />}
      <div className="row-btns">
        {recording === null ? (
          <button type="button" className="btn primary" disabled={pending || modelReady === null} onClick={() => run(() => window.codevo.startMeeting(), START_FAILURE)}>
            <Glyph name="record" size="sm" />
            Začať nahrávanie
          </button>
        ) : (
          <button type="button" className="btn danger" disabled={pending} onClick={() => run(() => window.codevo.stopMeeting(), STOP_FAILURE)}>
            <Glyph name="stop" size="sm" />
            Zastaviť a prepísať
          </button>
        )}
      </div>
      {failure !== null && (
        <div className="rec-failure" role="alert">
          <p>{failure.message}</p>
          <RemedyLinks remedies={failure.remedies} onNavigate={onNavigate} />
        </div>
      )}
      <p className="note">
        <Glyph name="headphones" size="sm" />
        {HEADPHONES_TIP}
      </p>
    </section>
  );
}
