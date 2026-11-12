import { useState } from 'react';
import type { ModelInfo } from '../../shared/models';
import type { EngineId } from '../../shared/settings';
import { liveValueOr } from '../home/live-value';
import { languagePackNote } from './language-pack-note';
import { useLanguagePack } from './use-language-pack';
import { MODEL_FAILURES } from './use-model-actions';

type Props = { engineOrder: readonly EngineId[]; activeModel: ModelInfo | null };

export function LanguagePackNote({ engineOrder, activeModel }: Props) {
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const note = languagePackNote(liveValueOr(useLanguagePack(), null), engineOrder, activeModel);
  if (note === null) {
    return null;
  }

  function download(): void {
    setFailed(false);
    setPending(true);
    window.codevo
      .downloadLanguagePack()
      .catch((error: unknown) => {
        console.error('Downloading the language pack failed', error);
        setFailed(true);
      })
      .finally(() => setPending(false));
  }

  return (
    <div className="lang-pack" data-testid="language-pack">
      <p className={note.warn ? 'field-note warn' : 'field-note'}>{note.text}</p>
      {note.progress !== null && (
        <span className="progress" role="progressbar" aria-label="Sťahovanie modelov pre výber jazykov" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(note.progress * 100)}>
          <i style={{ width: `${note.progress * 100}%` }} />
        </span>
      )}
      {note.download !== 'none' && (
        <button type="button" className="btn" disabled={pending || note.download === 'busy'} onClick={download}>
          Stiahnuť
        </button>
      )}
      {failed && (
        <p className="field-note warn" role="alert">
          {MODEL_FAILURES.download}
        </p>
      )}
    </div>
  );
}
