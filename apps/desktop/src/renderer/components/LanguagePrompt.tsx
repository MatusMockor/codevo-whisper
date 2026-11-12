import { LANGUAGE_NAMES, type DictationLanguage } from '../../shared/dictation-languages';
import type { LanguagePrompt as Prompt } from '../settings/use-model-actions';

const CHOICES: readonly DictationLanguage[] = ['sk', 'cs', 'en'];

type LanguagePromptProps = { prompt: Prompt; onChoose: (language: DictationLanguage) => void; onCancel: () => void };

export function LanguagePrompt({ prompt, onChoose, onCancel }: LanguagePromptProps) {
  return (
    <div className="lang-prompt" role="dialog" aria-labelledby="lang-prompt-title" aria-describedby="lang-prompt-text">
      <b id="lang-prompt-title">Vyberte jazyk diktovania</b>
      <p id="lang-prompt-text">Model {prompt.model.name} potrebuje vedieť, akým jazykom budete hovoriť. Automatické rozpoznanie s ním nefunguje.</p>
      <div className="row-btns">
        {CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            className="btn primary"
            onClick={() => {
              onChoose(choice);
            }}
          >
            {LANGUAGE_NAMES[choice]}
          </button>
        ))}
        <button type="button" className="btn ghost" onClick={onCancel}>
          Zrušiť
        </button>
      </div>
    </div>
  );
}
