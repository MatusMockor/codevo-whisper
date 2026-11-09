import { useEffect, useState } from 'react';
import type { Live } from '../home/live-value';
import { Glyph } from './Glyph';

const COPIED_MS = 1400;

type CopyState = 'idle' | 'copied' | 'failed';

function CopyLabel({ state }: { state: CopyState }) {
  if (state === 'copied') {
    return (
      <>
        <Glyph name="check" size="sm" />
        Skopírované
      </>
    );
  }
  if (state === 'failed') {
    return <>Nepodarilo sa skopírovať</>;
  }
  return (
    <>
      <Glyph name="copy" size="sm" />
      Kopírovať
    </>
  );
}

function transcriptText(transcript: Live<string | null>): string | null {
  return transcript.kind === 'ready' ? transcript.value : null;
}

function placeholder(transcript: Live<string | null>): string {
  if (transcript.kind === 'failed') {
    return 'Posledné diktovanie sa nepodarilo načítať.';
  }
  return 'Zatiaľ nemáte žiadny prepis.';
}

export function LastTranscriptCard({ transcript }: { transcript: Live<string | null> }) {
  const [copy, setCopy] = useState<CopyState>('idle');
  const text = transcriptText(transcript);

  useEffect(() => {
    if (copy === 'idle') {
      return;
    }
    const timer = setTimeout(() => setCopy('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copy]);

  function copyText(): void {
    if (text === null) {
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => setCopy('copied'),
      () => setCopy('failed'),
    );
  }

  return (
    <section className="last" aria-labelledby="h-last">
      <div className="last-top">
        <h2 id="h-last">Posledné diktovanie</h2>
        <button type="button" className={copy === 'copied' ? 'btn sm ok' : 'btn sm'} disabled={text === null} onClick={copyText} aria-live="polite">
          <CopyLabel state={copy} />
        </button>
      </div>
      <p className={text === null ? 'empty' : 'transcript'}>{text ?? placeholder(transcript)}</p>
      <p className="note">
        <Glyph name="lock" size="sm" />
        Táto karta ostáva v pamäti do zatvorenia aplikácie. Voliteľnú históriu na disku spravujete v Nastaveniach.
      </p>
    </section>
  );
}
