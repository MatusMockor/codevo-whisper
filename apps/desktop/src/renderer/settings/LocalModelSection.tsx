import type { LocalAcceleration, LocalModelUnload, Settings } from '../../shared/settings';
import { LanguagePrompt } from '../components/LanguagePrompt';
import { ModelList } from '../components/ModelList';
import { SegmentedControl, type SegmentOption } from '../components/SegmentedControl';
import { SettingsRow } from './SettingsGroup';
import { saveSettings } from './use-settings';
import { busyModelId } from './model-rows';
import { useModelActions } from './use-model-actions';
import type { Models } from './use-models';

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
    </>
  );
}
