import { useId, useState } from 'react';
import { formatClock, type MeetingSummary } from '../../shared/meetings';
import { Glyph } from '../components/Glyph';
import type { NavTarget } from '../navigation';
import { recordedSystemAudioLabel } from './meeting-copy';
import { MeetingNotes } from './MeetingNotes';
import { MeetingTranscript } from './MeetingTranscript';
import { SpeakerTimeline } from './SpeakerTimeline';
import { useMeeting } from './use-meetings';

type Action = { kind: 'idle' } | { kind: 'confirm' } | { kind: 'pending' } | { kind: 'exported' } | { kind: 'failed'; message: string };

type MeetingDetailProps = { summary: MeetingSummary; onNavigate: (target: NavTarget) => void };

export function MeetingDetail({ summary, onNavigate }: MeetingDetailProps) {
  const id = useId();
  const meeting = useMeeting(summary);
  const [action, setAction] = useState<Action>({ kind: 'idle' });
  const busy = summary.phase.kind === 'recording' || summary.phase.kind === 'transcribing';
  const pending = action.kind === 'pending';
  const turns = summary.phase.kind === 'ready' && meeting.kind === 'ready' ? (meeting.value?.turns ?? []) : [];

  function run(command: () => Promise<unknown>, done: (result: unknown) => Action = () => ({ kind: 'idle' })): void {
    setAction({ kind: 'pending' });
    command().then(
      (result) => setAction(done(result)),
      () => setAction({ kind: 'failed', message: 'Akciu sa nepodarilo vykonať. Skúste to znova.' }),
    );
  }

  return (
    <section className="last meeting-detail" aria-labelledby={id} aria-busy={pending} onKeyDown={(event) => { if (action.kind === 'confirm' && event.key === 'Escape') setAction({ kind: 'idle' }); }}>
      <div className="det-head">
        <div>
          <h2 id={id}>{summary.title}</h2>
          <p className="det-meta">
            {formatClock(summary.durationMs)} · Zvuk systému: {recordedSystemAudioLabel(summary.systemAudio)}
          </p>
          {summary.systemAudioNote !== null && <p className="note">{summary.systemAudioNote}</p>}
        </div>
        <div className="row-btns">
          <button type="button" className="btn sm" disabled={summary.phase.kind !== 'ready' || pending} onClick={() => run(() => window.codevo.exportMeeting(summary.id), (saved) => ({ kind: saved === true ? 'exported' : 'idle' }))}>
            <Glyph name="export" size="sm" />
            Exportovať do Markdownu
          </button>
          <button type="button" className="btn sm" disabled={busy || pending || summary.notesPending} onClick={() => run(() => window.codevo.retranscribeMeeting(summary.id))}>
            <Glyph name="refresh" size="sm" />
            Prepísať znova
          </button>
          <button type="button" className="btn sm danger" disabled={busy || pending || summary.notesPending || action.kind === 'confirm'} onClick={() => setAction({ kind: 'confirm' })}>
            <Glyph name="trash" size="sm" />
            Zmazať
          </button>
        </div>
      </div>
      {action.kind === 'confirm' && (
        <div className="history-confirm">
          <p id="meeting-delete-confirm">Zmazať stretnutie aj s nahrávkou, prepisom a poznámkami? Túto akciu nemožno vrátiť.</p>
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
      {action.kind === 'exported' && (
        <p className="note" role="status">
          <Glyph name="check" size="sm" />
          Stretnutie bolo exportované do Markdownu.
        </p>
      )}
      {action.kind === 'failed' && (
        <p className="load-error" role="alert">
          {action.message}
        </p>
      )}
      <SpeakerTimeline turns={turns} durationMs={summary.durationMs} />
      <div className="meeting-body">
        <MeetingNotes summary={summary} meeting={meeting} onNavigate={onNavigate} />
        <MeetingTranscript summary={summary} meeting={meeting} />
      </div>
    </section>
  );
}
