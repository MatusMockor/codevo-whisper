import { MicrophonePicker } from '../components/MicrophonePicker';
import { DictationSection } from '../settings/DictationSection';
import { EngineSection } from '../settings/EngineSection';
import { InsertionSection } from '../settings/InsertionSection';
import { LocalModelSection } from '../settings/LocalModelSection';
import { SaveErrorNotice } from '../settings/SaveErrorNotice';
import { SettingsGroup } from '../settings/SettingsGroup';
import { SystemSection } from '../settings/SystemSection';
import { useModels } from '../settings/use-models';
import { saveSettings, useSettings } from '../settings/use-settings';

export function Settings() {
  const settings = useSettings();
  const models = useModels();
  if (settings.kind === 'loading') {
    return null;
  }
  if (settings.kind === 'failed') {
    return (
      <p className="load-error" role="alert">
        Nastavenia sa nepodarilo načítať.
      </p>
    );
  }
  const value = settings.value;
  const activeModel = models.catalog.kind === 'ready' ? (models.catalog.value.models.find((model) => model.id === value.localModelId) ?? null) : null;
  return (
    <div className="groups">
      <SaveErrorNotice />
      <DictationSection settings={value} activeModel={activeModel} />
      <EngineSection />
      <SettingsGroup title="Lokálny model">
        <LocalModelSection settings={value} models={models} />
      </SettingsGroup>
      <SettingsGroup title="Mikrofón">
        <MicrophonePicker microphone={value.microphone} onChange={(microphone) => saveSettings({ microphone })} />
      </SettingsGroup>
      <InsertionSection insertion={value.insertion} />
      <SystemSection launchAtLogin={value.launchAtLogin} />
    </div>
  );
}
