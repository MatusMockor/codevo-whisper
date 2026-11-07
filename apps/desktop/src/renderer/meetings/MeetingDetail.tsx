import { useState } from 'react';
import type { Live } from '../home/live-value';
import { formatClock, MEETING_DATE, turnLine, type Meeting, type MeetingSummary } from '../../shared/meetings';
import { useSettings } from '../settings/use-settings';
import { notesFailureMessage, phaseLabel, recordedSystemAudioLabel } from './meeting-copy';
import { useMeeting } from './use-meetings';

type Action = { kind: 'idle' } | { kind: 'confirm' } | { kind: 'pending' } | { kind: 'exported' } | { kind: 'failed'; message: string };

function useAiReady(): boolean | null {
  const settings = useSettings();
  if (settings.kind !== 'ready') return settings.kind === 'loading' ? null : false;
  return settings.value.aiBaseUrl !== null && settings.value.aiModel !== '';
}

function Transcript({ summary, meeting }: { summary: MeetingSummary; meeting: Live<Meeting | null> }) {
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

function Notes({ summary, meeting, onOpenSettings }: { summary: MeetingSummary; meeting: Live<Meeting | null>; onOpenSettings: () => void }) {
  const aiReady = useAiReady();
  const [failed, setFailed] = useState(false);
  const loaded = meeting.kind === 'ready' ? meeting.value : null;
  const notes = loaded?.notes ?? null;
  const hasSpeech = (loaded?.turns.length ?? 0) > 0;
  const canGenerate = aiReady === true && summary.phase.kind === 'ready' && hasSpeech && !summary.notesPending;

  function generate(): void {
    setFailed(false);
    window.codevo.generateMeetingNotes(summary.id).catch((error: unknown) => {
      console.error('Starting the meeting notes failed', error);
      setFailed(true);
    });
  }

  return (
    <section className="meeting-part" aria-labelledby="h-meeting-notes" aria-busy={summary.notesPending}>
      <div className="last-top">
        <h3 id="h-meeting-notes">Poznámky</h3>
        <button type="button" className="btn" disabled={!canGenerate} aria-describedby="meeting-notes-hint" onClick={generate}>
          {notes === null ? 'Vytvoriť poznámky' : 'Vytvoriť znova'}
        </button>
      </div>
      {aiReady === false ? (
        <p className="note" id="meeting-notes-hint">
          Poznámky vytvára AI server. Nastavte jeho adresu a model v Nastaveniach v časti „AI úprava textu“.
          <button type="button" className="linkbtn" onClick={onOpenSettings}>
            Otvoriť Nastavenia
          </button>
        </p>
      ) : (
        <p className="note" id="meeting-notes-hint">
          Lokálne servery ako Ollama majú predvolene malé kontextové okno. Pri dlhých stretnutiach ho zväčšite, napríklad premennou OLLAMA_CONTEXT_LENGTH. Pre spoľahlivé poznámky použite model so 7B a viac parametrami, menšie modely si vymýšľajú.
        </p>
      )}
      {summary.notesPending && (
        <p className="empty" role="status">
          Vytvárajú sa poznámky… Pri dlhom stretnutí to môže trvať niekoľko minút.
        </p>
      )}
      {(failed || summary.notesError !== null) && (
        <p className="load-error" role="alert">
          {failed ? 'Poznámky sa nepodarilo spustiť. Skúste to znova.' : notesFailureMessage(summary.notesError ?? 'unexpected')}
        </p>
      )}
      {notes !== null ? (
        <pre className="meeting-notes" aria-label="Poznámky zo stretnutia">
          {notes}
        </pre>
      ) : (
        !summary.notesPending && <p className="empty">Zatiaľ bez poznámok. Vytvoria sa z prepisu: zhrnutie, rozhodnutia, otvorené otázky a úlohy.</p>
      )}
    </section>
  );
}

export function MeetingDetail({ summary, onOpenSettings }: { summary: MeetingSummary; onOpenSettings: () => void }) {
  const meeting = useMeeting(summary);
  const [action, setAction] = useState<Action>({ kind: 'idle' });
  const busy = summary.phase.kind === 'recording' || summary.phase.kind === 'transcribing';
  const pending = action.kind === 'pending';

  function run(command: () => Promise<unknown>, done: (result: unknown) => Action = () => ({ kind: 'idle' })): void {
    setAction({ kind: 'pending' });
    command().then(
      (result) => setAction(done(result)),
      () => setAction({ kind: 'failed', message: 'Akciu sa nepodarilo vykonať. Skúste to znova.' }),
    );
  }

  return (
    <section className="last history meeting-detail" aria-labelledby="h-meeting" aria-busy={pending} onKeyDown={(event) => { if (action.kind === 'confirm' && event.key === 'Escape') setAction({ kind: 'idle' }); }}>
      <div className="last-top">
        <h2 id="h-meeting">{summary.title}</h2>
        <div className="row-btns">
          <button type="button" className="btn" disabled={summary.phase.kind !== 'ready' || pending} onClick={() => run(() => window.codevo.exportMeeting(summary.id), (saved) => ({ kind: saved === true ? 'exported' : 'idle' }))}>
            Exportovať do Markdownu
          </button>
          <button type="button" className="btn" disabled={busy || pending || summary.notesPending} onClick={() => run(() => window.codevo.retranscribeMeeting(summary.id))}>
            Prepísať znova
          </button>
          <button type="button" className="btn danger" disabled={busy || pending || summary.notesPending || action.kind === 'confirm'} onClick={() => setAction({ kind: 'confirm' })}>
            Zmazať
          </button>
        </div>
      </div>
      <p className="note">
        <time dateTime={new Date(summary.startedAt).toISOString()}>{MEETING_DATE.format(summary.startedAt)}</time> · {formatClock(summary.durationMs)} · Zvuk systému: {recordedSystemAudioLabel(summary.systemAudio)}
      </p>
      {summary.systemAudioNote !== null && <p className="note">{summary.systemAudioNote}</p>}
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
          Stretnutie bolo exportované do Markdownu.
        </p>
      )}
      {action.kind === 'failed' && (
        <p className="load-error" role="alert">
          {action.message}
        </p>
      )}
      <Notes summary={summary} meeting={meeting} onOpenSettings={onOpenSettings} />
      <section className="meeting-part" aria-labelledby="h-meeting-transcript">
        <h3 id="h-meeting-transcript">Prepis</h3>
        <Transcript summary={summary} meeting={meeting} />
      </section>
    </section>
  );
}
