import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon, LockIcon } from './Icons';

const COPIED_MS = 1400;

type CopyState = 'idle' | 'copied' | 'failed';

function CopyLabel({ state }: { state: CopyState }) {
  if (state === 'copied') {
    return (
      <>
        <CheckIcon />
        Skopírované
      </>
    );
  }
  if (state === 'failed') {
    return <>Nepodarilo sa skopírovať</>;
  }
  return (
    <>
      <CopyIcon />
      Kopírovať
    </>
  );
}

export function LastTranscriptCard({ text }: { text: string | null }) {
  const [copy, setCopy] = useState<CopyState>('idle');

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
        <button type="button" className={copy === 'copied' ? 'btn ok' : 'btn'} disabled={text === null} onClick={copyText} aria-live="polite">
          <CopyLabel state={copy} />
        </button>
      </div>
      <p className={text === null ? 'empty' : undefined}>{text ?? 'Zatiaľ nemáte žiadny prepis.'}</p>
      <p className="note">
        <LockIcon />
        Uchováva sa len do zatvorenia aplikácie. Nič sa neukladá na disk.
      </p>
    </section>
  );
}
