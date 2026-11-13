import { useState } from 'react';
import type { LocalAcceleration, LocalModelUnload, Settings } from '../../shared/settings';
import { LanguagePrompt } from '../components/LanguagePrompt';
import { ModelList } from '../components/ModelList';
import { SegmentedControl, type SegmentOption } from '../components/SegmentedControl';
import { SettingsRow } from '../settings/SettingsGroup';
import { saveSettings } from '../settings/use-settings';
import { busyModelId } from '../settings/model-rows';
import { useModelActions } from '../settings/use-model-actions';
import type { Models } from '../settings/use-models';

const UNLOAD_OPTIONS: ReadonlyArray<{ value: LocalModelUnload; label: string }> = [
  { value: 'never', label: 'Nikdy' },
  { value: 'immediately', label: 'Ihneď' },
  { value: 2, label: 'Po 2 minútach' },
  { value: 5, label: 'Po 5 minútach' },
  { value: 10, label: 'Po 10 minútach' },
  { value: 15, label: 'Po 15 minútach' },
  { value: 60, label: 'Po 1 hodine' },
];
const ACCELERATIONS: ReadonlyArray<SegmentOption<LocalAcceleration>> = [
  { id: 'auto', label: 'Auto' },
  { id: 'gpu', label: 'GPU' },
  { id: 'cpu', label: 'CPU' },
];

function UseExistingFile() {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  function pick(): void {
    setState('busy');
    window.codevo.useExistingModel().then(
      () => setState('idle'),
      (error: unknown) => {
        console.error('Using an existing model file failed', error);
        setState('failed');
      },
    );
  }
  return (
    <div className="model-existing">
      <button type="button" className="btn" disabled={state === 'busy'} onClick={pick}>
        Použiť existujúci súbor…
      </button>
      {state === 'failed' && (
        <p className="field-note warn" role="alert">
          Súbor sa nezhoduje so žiadnym modelom zo zoznamu.
        </p>
      )}
    </div>
  );
}

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
    <div className="card model-card">
      <p className="card-lead">Model sa stiahne z Hugging Face iba po kliknutí na Stiahnuť a uloží sa do tohto počítača. Ak ho už máte z Handy alebo z Hugging Face cache, použije sa bez sťahovania. Potom prepis funguje aj bez internetu.</p>
      <ModelList
        models={models.catalog.value.models}
        states={models.states}
        context={{ activeId: settings.localModelId, busyId: busyModelId(models.states) }}
        errors={actions.errors}
        onAction={actions.run}
      />
      <UseExistingFile />
      <SettingsRow title="Uvoľniť model" titleId="set-local-unload" description="Čas sa počíta od konca posledného diktovania. Počas diktovania a dokončovania prepisu model zostáva načítaný.">
        <select
          className="select"
          aria-labelledby="set-local-unload"
          value={settings.localModelUnload}
          onChange={(event) => {
            const option = UNLOAD_OPTIONS.find((item) => String(item.value) === event.target.value);
            if (option !== undefined) saveSettings({ localModelUnload: option.value });
          }}
        >
          {UNLOAD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow title="Akcelerácia" description="Auto používa GPU na Apple Silicon a CPU na Intel Macu. Zmena sa použije po dokončení aktuálneho diktovania. Na ostatných systémoch sa používa CPU.">
        <SegmentedControl label="Akcelerácia" options={ACCELERATIONS} value={settings.localAcceleration} onChange={(localAcceleration) => saveSettings({ localAcceleration })} />
      </SettingsRow>
      {actions.prompt !== null && <LanguagePrompt prompt={actions.prompt} onChoose={actions.chooseLanguage} onCancel={actions.cancelPrompt} />}
    </div>
  );
}
