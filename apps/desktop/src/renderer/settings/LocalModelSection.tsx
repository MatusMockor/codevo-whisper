import type { Settings } from '../../shared/settings';
import { LanguagePrompt } from '../components/LanguagePrompt';
import { ModelList } from '../components/ModelList';
import { busyModelId } from './model-rows';
import { useModelActions } from './use-model-actions';
import type { Models } from './use-models';

export function LocalModelSection({ settings, models }: { settings: Settings; models: Models }) {
  const actions = useModelActions(settings);
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
  return (
    <>
      <p className="sbox-lead">Model sa stiahne z Hugging Face iba po kliknutí na Stiahnuť a uloží sa na tento Mac. Potom prepis funguje aj bez internetu.</p>
      <ModelList
        models={models.catalog.value.models}
        states={models.states}
        context={{ activeId: settings.localModelId, busyId: busyModelId(models.states) }}
        errors={actions.errors}
        onAction={actions.run}
      />
      {actions.prompt !== null && <LanguagePrompt prompt={actions.prompt} onChoose={actions.chooseLanguage} onCancel={actions.cancelPrompt} />}
    </>
  );
}
