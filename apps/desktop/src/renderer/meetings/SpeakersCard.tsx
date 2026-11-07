import { useState } from 'react';
import { ModelList } from '../components/ModelList';
import { useLiveValue } from '../home/live-value';
import type { ModelAction } from '../settings/model-rows';
import { MODEL_FAILURES } from '../settings/use-model-actions';

const loadDiarizer = () => window.codevo.getDiarizer();

function invoke(action: ModelAction): Promise<void> {
  if (action === 'pause') return window.codevo.pauseDiarizer();
  if (action === 'delete') return window.codevo.deleteDiarizer();
  return window.codevo.downloadDiarizer();
}

export function SpeakersCard() {
  const diarizer = useLiveValue('diarizer-changed', loadDiarizer);
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
    <section className="card meeting-speakers" aria-labelledby="h-speakers">
      <h2 id="h-speakers">Rozpoznávanie hovoriacich</h2>
      <p className="srv-text">
        Voliteľný model rozlíši v zvuku systému až štyroch hovoriacich ako Hovoriaci 1 až 4. Bez neho sa celá druhá strana označí ako Ostatní. Stiahne sa z Hugging Face iba po kliknutí na Stiahnuť a použije sa aj pri Prepísať znova.
      </p>
      <ModelList
        label="Model na rozpoznávanie hovoriacich"
        models={[model]}
        states={[state]}
        context={{ activeId: model.id, busyId: null }}
        errors={error === null ? {} : { [model.id]: error }}
        onAction={(_model, action) => run(action)}
      />
    </section>
  );
}
