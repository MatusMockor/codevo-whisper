import { useState } from 'react';
import type { Settings } from '../../shared/settings';
import { LanguagePrompt } from '../components/LanguagePrompt';
import { ModelActions, ModelList, modelRowFor } from '../components/ModelList';
import { busyModelId } from '../settings/model-rows';
import { useModelActions } from '../settings/use-model-actions';
import type { Models } from '../settings/use-models';

export function ModelStep({ settings, models }: { settings: Settings; models: Models }) {
  const actions = useModelActions(settings);
  const [chosen, setChosen] = useState<string | null>(null);
  if (models.catalog.kind === 'loading') {
    return null;
  }
  if (models.catalog.kind === 'failed') {
    return (
      <p className="field-note warn" role="alert">
        Zoznam modelov sa nepodarilo načítať.
      </p>
    );
  }
  const { models: catalog, defaultModelId } = models.catalog.value;
  const selected = chosen ?? settings.localModelId ?? defaultModelId;
  const model = catalog.find((candidate) => candidate.id === selected);
  const context = { activeId: settings.localModelId, busyId: busyModelId(models.states) };
  return (
    <>
      <ModelList models={catalog} states={models.states} context={context} errors={actions.errors} onAction={actions.run} selection={{ selected, onSelect: setChosen }} />
      {model !== undefined && (
        <div className="ob-model-actions">
          <ModelActions row={modelRowFor(model, models.states, context)} onAction={(action) => actions.run(model, action)} />
        </div>
      )}
      {actions.prompt !== null && <LanguagePrompt prompt={actions.prompt} onChoose={actions.chooseLanguage} onCancel={actions.cancelPrompt} />}
    </>
  );
}
