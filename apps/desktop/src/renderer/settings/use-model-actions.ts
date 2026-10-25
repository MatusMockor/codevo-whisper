import { useState } from 'react';
import type { ModelInfo } from '../../shared/models';
import type { Language, Settings } from '../../shared/settings';
import { needsLanguageChoice } from './language-options';
import type { ModelAction } from './model-rows';

export type LanguagePrompt = { model: ModelInfo; action: ModelAction };

export type ModelActionsView = {
  run: (model: ModelInfo, action: ModelAction) => void;
  errors: Readonly<Record<string, string>>;
  prompt: LanguagePrompt | null;
  chooseLanguage: (language: Exclude<Language, 'auto'>) => void;
  cancelPrompt: () => void;
};

const FAILURES: Readonly<Record<ModelAction, string>> = {
  download: 'Sťahovanie zlyhalo. Skontrolujte pripojenie na internet a skúste to znova.',
  continue: 'Sťahovanie zlyhalo. Skontrolujte pripojenie na internet a skúste to znova.',
  pause: 'Sťahovanie sa nepodarilo pozastaviť.',
  delete: 'Model sa nepodarilo odstrániť.',
  activate: 'Model sa nepodarilo použiť. Skúste ho stiahnuť znova.',
};

function invoke(id: string, action: ModelAction): Promise<void> {
  if (action === 'pause') {
    return window.codevo.pauseModel(id);
  }
  if (action === 'delete') {
    return window.codevo.deleteModel(id);
  }
  if (action === 'activate') {
    return window.codevo.activateModel(id);
  }
  return window.codevo.downloadModel(id);
}

export function useModelActions(settings: Pick<Settings, 'language' | 'localModelId'>): ModelActionsView {
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [prompt, setPrompt] = useState<LanguagePrompt | null>(null);

  function perform(model: ModelInfo, action: ModelAction): void {
    setErrors(({ [model.id]: _cleared, ...rest }) => rest);
    invoke(model.id, action).catch((error: unknown) => {
      console.error(`Model action ${action} failed for ${model.id}`, error);
      setErrors((current) => ({ ...current, [model.id]: FAILURES[action] }));
    });
  }

  return {
    errors,
    prompt,
    run: (model, action) => {
      if (needsLanguageChoice(model, action, settings)) {
        setPrompt({ model, action });
        return;
      }
      perform(model, action);
    },
    chooseLanguage: (language) => {
      if (prompt === null) {
        return;
      }
      setPrompt(null);
      window.codevo.updateSettings({ language }).then(
        () => perform(prompt.model, prompt.action),
        (error: unknown) => {
          console.error('Saving the language failed', error);
          setErrors((current) => ({ ...current, [prompt.model.id]: FAILURES[prompt.action] }));
        },
      );
    },
    cancelPrompt: () => setPrompt(null),
  };
}
