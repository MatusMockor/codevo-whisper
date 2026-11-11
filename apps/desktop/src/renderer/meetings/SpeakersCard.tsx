import { useId, useState } from 'react';
import { ModelList } from '../components/ModelList';
import { Led } from '../components/Led';
import type { ModelAction } from '../settings/model-rows';
import { MODEL_FAILURES } from '../settings/use-model-actions';
import { useDiarizer } from './use-meetings';

function invoke(action: ModelAction): Promise<void> {
  if (action === 'pause') return window.codevo.pauseDiarizer();
  if (action === 'delete') return window.codevo.deleteDiarizer();
  return window.codevo.downloadDiarizer();
}

export function SpeakersCard() {
  const id = useId();
  const diarizer = useDiarizer();
  const [error, setError] = useState<string | null>(null);
  if (diarizer.kind === 'loading') return null;
  if (diarizer.kind === 'failed') {
    return (
      <p className="load-error meeting-speakers" role="alert">
        Model na rozpoznávanie hovoriacich sa nepodarilo načítať.
      </p>
    );
  }
  const { model, state } = diarizer.value;

  function run(action: ModelAction): void {
    setError(null);
    invoke(action).catch((caught: unknown) => {
      console.error(`Diarizer action ${action} failed`, caught);
      setError(MODEL_FAILURES[action]);
    });
  }

  return (
    <section className="last meeting-speakers" aria-labelledby={id}>
      <div className="last-top">
        <h2 id={id}>Rozpoznávanie hovoriacich</h2>
        <Led state={state.status === 'ready' ? 'ok' : 'off'} />
      </div>
      <p className="rec-text">Rozlíši v zvuku systému až štyroch hovoriacich. Bez modelu je celá druhá strana Ostatní.</p>
      <ModelList
        label="Model na rozpoznávanie hovoriacich"
        models={[model]}
        states={[state]}
        context={{ activeId: model.id, busyId: null }}
        errors={error === null ? {} : { [model.id]: error }}
        onAction={(_model, action) => run(action)}
      />
      <p className="note">Stiahne sa z Hugging Face iba po kliknutí na Stiahnuť. Použije sa aj pri Prepísať znova.</p>
    </section>
  );
}
