import { useId, useState } from 'react';
import type { Meeting, MeetingSummary } from '../../shared/meetings';
import { Glyph } from '../components/Glyph';
import type { Live } from '../home/live-value';
import type { NavTarget } from '../navigation';
import { notesFailureMessage } from './meeting-copy';
import { notesRemedy, SET_UP_AI } from './meeting-remedies';
import { RemedyLinks } from './RemedyLinks';
import { useNotesProvider, type NotesProvider } from './use-meetings';

type NotesProps = { summary: MeetingSummary; meeting: Live<Meeting | null>; onNavigate: (target: NavTarget) => void };

const LOCAL_MODEL_TIPS = 'Lokálne servery ako Ollama majú predvolene malé kontextové okno. Pri dlhých stretnutiach ho zväčšite, napríklad premennou OLLAMA_CONTEXT_LENGTH. Pre spoľahlivé poznámky použite model so 7B a viac parametrami, menšie modely si vymýšľajú.';

function ProviderHint({ id, provider, onNavigate }: { id: string; provider: NotesProvider | null; onNavigate: (target: NavTarget) => void }) {
  if (provider === null) {
    return null;
  }
  if (provider === 'none') {
    return (
      <p className="note" id={id}>
        Poznámky vytvára AI server alebo Codex CLI. Zatiaľ nie je nastavený ani jeden.
        <RemedyLinks remedies={[SET_UP_AI]} onNavigate={onNavigate} />
      </p>
    );
  }
  if (provider === 'codex') {
    return (
      <p className="note" id={id}>
        Poznámky vytvára Codex CLI. Prepis stretnutia sa odošle do OpenAI pod vaším účtom a čerpá limity vášho predplatného ChatGPT.
      </p>
    );
  }
  return (
    <>
      <p className="note" id={id}>
        Poznámky vytvára váš AI server z prepisu stretnutia.
      </p>
      <details className="hint-more">
        <summary>Tipy pre lokálne modely</summary>
        <p>{LOCAL_MODEL_TIPS}</p>
      </details>
    </>
  );
}

function NotesFailureNotice({ summary, startFailed, onNavigate }: { summary: MeetingSummary; startFailed: boolean; onNavigate: (target: NavTarget) => void }) {
  if (startFailed) {
    return (
      <p className="load-error" role="alert">
        Poznámky sa nepodarilo spustiť. Skúste to znova.
      </p>
    );
  }
  if (summary.notesError === null) {
    return null;
  }
  const remedy = notesRemedy(summary.notesError);
  return (
    <div className="notes-failure" role="alert">
      <p>{notesFailureMessage(summary.notesError)}</p>
      <RemedyLinks remedies={remedy === null ? [] : [remedy]} onNavigate={onNavigate} />
    </div>
  );
}

export function MeetingNotes({ summary, meeting, onNavigate }: NotesProps) {
  const id = useId();
  const hintId = useId();
  const provider = useNotesProvider();
  const [startFailed, setStartFailed] = useState(false);
  const loaded = meeting.kind === 'ready' ? meeting.value : null;
  const notes = loaded?.notes ?? null;
  const hasSpeech = (loaded?.turns.length ?? 0) > 0;
  const canGenerate = provider !== null && provider !== 'none' && summary.phase.kind === 'ready' && hasSpeech && !summary.notesPending;

  function generate(): void {
    setStartFailed(false);
    window.codevo.generateMeetingNotes(summary.id).catch((error: unknown) => {
      console.error('Starting the meeting notes failed', error);
      setStartFailed(true);
    });
  }

  return (
    <section className="meeting-part meeting-part-notes" aria-labelledby={id} aria-busy={summary.notesPending}>
      <div className="part-top">
        <h3 id={id}>Poznámky</h3>
        <button type="button" className="btn sm" disabled={!canGenerate} aria-describedby={hintId} onClick={generate}>
          <Glyph name="spark" size="sm" />
          {notes === null ? 'Vytvoriť poznámky' : 'Vytvoriť znova'}
        </button>
      </div>
      <ProviderHint id={hintId} provider={provider} onNavigate={onNavigate} />
      {summary.notesPending && (
        <p className="empty" role="status">
          Vytvárajú sa poznámky… Pri dlhom stretnutí to môže trvať niekoľko minút.
        </p>
      )}
      <NotesFailureNotice summary={summary} startFailed={startFailed} onNavigate={onNavigate} />
      {notes !== null && (
        <pre className="meeting-notes" aria-label="Poznámky zo stretnutia">
          {notes}
        </pre>
      )}
      {notes === null && !summary.notesPending && <p className="empty">Zatiaľ bez poznámok. Vytvoria sa z prepisu: zhrnutie, rozhodnutia, otvorené otázky a úlohy.</p>}
    </section>
  );
}
