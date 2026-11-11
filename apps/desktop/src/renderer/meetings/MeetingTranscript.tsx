import { useId } from 'react';
import { formatClock, type Meeting, type MeetingSummary } from '../../shared/meetings';
import type { Live } from '../home/live-value';
import { phaseLabel } from './meeting-copy';
import { speakerTone } from './speaker-lanes';

type TranscriptProps = { summary: MeetingSummary; meeting: Live<Meeting | null> };

function TranscriptBody({ summary, meeting }: TranscriptProps) {
  const { phase } = summary;
  if (phase.kind === 'failed') {
    return (
      <p className="load-error" role="alert">
        {phase.error}
      </p>
    );
  }
  if (phase.kind !== 'ready') {
    return (
      <p className="empty" role="status">
        {phase.kind === 'stopped' ? 'Stretnutie čaká na prepis.' : `${phaseLabel(phase)}…`}
      </p>
    );
  }
  if (meeting.kind === 'loading') {
    return <p className="empty">Načítava sa prepis…</p>;
  }
  if (meeting.kind === 'failed' || meeting.value === null) {
    return (
      <p className="load-error" role="alert">
        Prepis sa nepodarilo načítať.
      </p>
    );
  }
  if (meeting.value.turns.length === 0) {
    return <p className="empty">V nahrávke sa nenašla žiadna reč.</p>;
  }
  return (
    <ol className="meeting-transcript" aria-label="Prepis stretnutia">
      {meeting.value.turns.map((turn) => (
        <li key={`${turn.t0Ms}-${turn.speaker}`} className={`turn spk-${speakerTone(turn.speaker)}`}>
          <time>{formatClock(turn.t0Ms)}</time>
          <span className="turn-bar" aria-hidden="true" />
          <div>
            <b>{turn.speaker}</b>
            <p>{turn.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function MeetingTranscript(props: TranscriptProps) {
  const id = useId();
  return (
    <section className="meeting-part meeting-part-transcript" aria-labelledby={id}>
      <div className="part-top">
        <h3 id={id}>Prepis</h3>
      </div>
      <TranscriptBody {...props} />
    </section>
  );
}
