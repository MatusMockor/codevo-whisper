import type { Settings } from '../../shared/settings';
import type { Models } from '../settings/use-models';
import { saveSettings } from '../settings/use-settings';
import { ENGINE_CHOICES, engineOrderFor, LATER_NOTE, type EngineChoice } from './engine-choice';
import { ModelStep } from './ModelStep';
import { ServerChoice } from './ServerChoice';

type EngineStepProps = { settings: Settings; models: Models; choice: EngineChoice | null; onChoose: (choice: EngineChoice) => void };

function ChoiceBody({ choice, settings, models }: { choice: EngineChoice | null; settings: Settings; models: Models }) {
  if (choice === 'local') {
    return <ModelStep settings={settings} models={models} />;
  }
  if (choice === 'server') {
    return <ServerChoice />;
  }
  if (choice === 'later') {
    return <p className="field-note">{LATER_NOTE}</p>;
  }
  return null;
}

export function EngineStep({ settings, models, choice, onChoose }: EngineStepProps) {
  function choose(next: EngineChoice): void {
    onChoose(next);
    const order = engineOrderFor(next);
    if (order === null) {
      return;
    }
    saveSettings({ engineOrder: order });
  }

  return (
    <>
      <div className="sbox">
        <div className="radio" role="radiogroup" aria-label="Kde bude bežať prepis">
          {ENGINE_CHOICES.map((option) => (
            <label key={option.id}>
              <input type="radio" name="engine-choice" checked={choice === option.id} onChange={() => choose(option.id)} />
              <div>
                <b>{option.title}</b>
                <span>{option.description}</span>
              </div>
            </label>
          ))}
        </div>
      </div>
      <ChoiceBody choice={choice} settings={settings} models={models} />
    </>
  );
}
