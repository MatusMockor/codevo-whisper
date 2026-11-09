import { MicrophonePicker } from '../components/MicrophonePicker';
import { AiSection } from '../settings/AiSection';
import { DictationSection } from '../settings/DictationSection';
import { settingsSectionAnchor } from '../../shared/settings-focus';
import { engineCapabilities } from '../settings/engine-capabilities';
import { EngineSection } from '../settings/EngineSection';
import { HistorySection } from '../settings/HistorySection';
import { InsertionSection } from '../settings/InsertionSection';
import { LocalModelSection } from '../settings/LocalModelSection';
import { SaveErrorNotice } from '../settings/SaveErrorNotice';
import { SettingsGroup } from '../settings/SettingsGroup';
import { SystemSection } from '../settings/SystemSection';
import { TranscriptSection } from '../settings/TranscriptSection';
import { useModels } from '../settings/use-models';
import { saveSettings, useSettings } from '../settings/use-settings';
import { useServer } from '../server/use-server';
import { InputPermissionsStep } from '../onboarding/InputPermissionsStep';
import { usePermissions } from '../settings/use-permissions';
import { useSettingsFocus } from '../settings/use-settings-focus';

export function Settings() {
  const settings = useSettings();
  const models = useModels();
  const server = useServer();
  const permissions = usePermissions();
  useSettingsFocus(settings.kind === 'ready');
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
      <EngineSection engineOrder={value.engineOrder} paired={server.kind === 'ready' && server.value.server !== null} capabilities={engineCapabilities(value.localModelId, models, server.kind === 'ready' ? server.value : null)} />
      <SettingsGroup title="Lokálny model" anchor={settingsSectionAnchor('local-model')}>
        <LocalModelSection settings={value} models={models} />
      </SettingsGroup>
      <SettingsGroup title="Mikrofón">
        <MicrophonePicker microphone={value.microphone} onChange={(microphone) => saveSettings({ microphone })} />
      </SettingsGroup>
      <InsertionSection settings={value} />
      {permissions.permissions.kind === 'ready' && permissions.permissions.value.platform === 'linux' && <SettingsGroup title="Prístup k systému"><InputPermissionsStep permissions={permissions.permissions} refresh={permissions.refresh} /></SettingsGroup>}
      <TranscriptSection settings={value} />
      <AiSection settings={value} />
      <HistorySection />
      <SystemSection launchAtLogin={value.launchAtLogin} />
    </div>
  );
}
