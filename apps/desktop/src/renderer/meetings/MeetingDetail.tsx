import { useState } from 'react';
import type { MeetingSummary } from '../../shared/meetings';
import { formatClock, phaseLabel, systemAudioLabel, turnLine } from './meeting-copy';
import { useMeeting } from './use-meetings';

type Action = { kind: 'idle' } | { kind: 'confirm' } | { kind: 'pending' } | { kind: 'failed'; message: string };

const DATE_TIME = new Intl.DateTimeFormat('sk', { dateStyle: 'medium', timeStyle: 'short' });

function Transcript({ summary }: { summary: MeetingSummary }) {
  const meeting = useMeeting(summary);
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
        <li key={`${turn.t0Ms}-${turn.speaker}`}>{turnLine(turn)}</li>
      ))}
    </ol>
  );
}

export function MeetingDetail({ summary }: { summary: MeetingSummary }) {
  const [action, setAction] = useState<Action>({ kind: 'idle' });
  const busy = summary.phase.kind === 'recording' || summary.phase.kind === 'transcribing';
  const pending = action.kind === 'pending';

  function run(command: () => Promise<void>): void {
    setAction({ kind: 'pending' });
    command().then(
      () => setAction({ kind: 'idle' }),
      () => setAction({ kind: 'failed', message: 'Akciu sa nepodarilo vykonať. Skúste to znova.' }),
    );
  }

  return (
    <section className="last history meeting-detail" aria-labelledby="h-meeting" aria-busy={pending} onKeyDown={(event) => { if (action.kind === 'confirm' && event.key === 'Escape') setAction({ kind: 'idle' }); }}>
      <div className="last-top">
        <h2 id="h-meeting">{summary.title}</h2>
        <div className="row-btns">
          <button type="button" className="btn" disabled={busy || pending} onClick={() => run(() => window.codevo.retranscribeMeeting(summary.id))}>
            Prepísať znova
          </button>
          <button type="button" className="btn danger" disabled={busy || pending || action.kind === 'confirm'} onClick={() => setAction({ kind: 'confirm' })}>
            Zmazať
          </button>
        </div>
      </div>
      <p className="note">
        <time dateTime={new Date(summary.startedAt).toISOString()}>{DATE_TIME.format(summary.startedAt)}</time> · {formatClock(summary.durationMs)} · Zvuk systému: {systemAudioLabel(summary.systemAudio)}
      </p>
      {summary.systemAudioNote !== null && <p className="note">{summary.systemAudioNote}</p>}
      {action.kind === 'confirm' && (
        <div className="history-confirm">
          <p id="meeting-delete-confirm">Zmazať stretnutie aj s nahrávkou a prepisom? Túto akciu nemožno vrátiť.</p>
          <div className="row-btns">
            <button type="button" className="btn ghost" onClick={() => setAction({ kind: 'idle' })}>
              Zrušiť
            </button>
            <button type="button" className="btn danger" aria-describedby="meeting-delete-confirm" onClick={() => run(() => window.codevo.deleteMeeting(summary.id))}>
              Áno, zmazať
            </button>
          </div>
        </div>
      )}
      {action.kind === 'failed' && (
        <p className="load-error" role="alert">
          {action.message}
        </p>
      )}
      <Transcript summary={summary} />
    </section>
  );
}
