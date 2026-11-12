import type { Settings } from '../../shared/settings';
import { Glyph } from '../components/Glyph';
import type { Models } from '../settings/use-models';
import { saveSettings } from '../settings/use-settings';
import { useServer } from '../server/use-server';
import { ENGINE_CHOICES, engineOrderFor, LATER_NOTE, recommendedEngine, serverNeedsPairing, type EngineChoice, type EngineChoiceOption } from './engine-choice';
import { ModelStep } from './ModelStep';
import { ServerChoice } from './ServerChoice';

type EngineStepProps = { settings: Settings; models: Models; choice: EngineChoice | null; onChoose: (choice: EngineChoice) => void };

type ChoiceCardProps = { option: EngineChoiceOption; checked: boolean; recommended: boolean; onChoose: (choice: EngineChoice) => void };

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

function ChoiceCard({ option, checked, recommended, onChoose }: ChoiceCardProps) {
  return (
    <label className="ob-choice">
      <span className="ob-choice-head" aria-hidden="true">
        <span className="ei">
          <Glyph name={option.icon} />
        </span>
        {recommended && <span className="tag amber">odporúčané</span>}
        <span className="dot" />
      </span>
      <input type="radio" name="engine-choice" checked={checked} onChange={() => onChoose(option.id)} />
      <span className="ob-choice-t">
        <b>{option.title}</b>
        <span>{option.description}</span>
        {recommended && <span className="visually-hidden"> (odporúčané)</span>}
      </span>
    </label>
  );
}

function usePairedServer(): boolean {
  const server = useServer();
  return server.kind === 'ready' && !serverNeedsPairing(server.value);
}

export function EngineStep({ settings, models, choice, onChoose }: EngineStepProps) {
  const recommended = recommendedEngine(usePairedServer(), models.states);

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
      <div className="ob-choices" role="radiogroup" aria-label="Kde bude bežať prepis">
        {ENGINE_CHOICES.map((option) => (
          <ChoiceCard key={option.id} option={option} checked={choice === option.id} recommended={recommended === option.id} onChoose={choose} />
        ))}
      </div>
      <ChoiceBody choice={choice} settings={settings} models={models} />
    </>
  );
}
