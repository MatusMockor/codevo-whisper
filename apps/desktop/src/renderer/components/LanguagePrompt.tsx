import type { Language } from '../../shared/settings';
import type { LanguagePrompt as Prompt } from '../settings/use-model-actions';

const CHOICES: ReadonlyArray<{ id: Exclude<Language, 'auto'>; label: string }> = [
  { id: 'sk', label: 'Slovenčina' },
  { id: 'cs', label: 'Čeština' },
  { id: 'en', label: 'Angličtina' },
];

type LanguagePromptProps = { prompt: Prompt; onChoose: (language: Exclude<Language, 'auto'>) => void; onCancel: () => void };

export function LanguagePrompt({ prompt, onChoose, onCancel }: LanguagePromptProps) {
  return (
    <div className="lang-prompt" role="dialog" aria-labelledby="lang-prompt-title" aria-describedby="lang-prompt-text">
      <b id="lang-prompt-title">Vyberte jazyk diktovania</b>
      <p id="lang-prompt-text">Model {prompt.model.name} potrebuje vedieť, akým jazykom budete hovoriť. Automatické rozpoznanie s ním nefunguje.</p>
      <div className="row-btns">
        {CHOICES.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className="btn primary"
            onClick={() => {
              onChoose(choice.id);
            }}
          >
            {choice.label}
          </button>
        ))}
        <button type="button" className="btn ghost" onClick={onCancel}>
          Zrušiť
        </button>
      </div>
    </div>
  );
}
