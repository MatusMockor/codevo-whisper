import { MicrophonePicker } from '../components/MicrophonePicker';
import { AiSection } from '../settings/AiSection';
import { DictationSection } from '../settings/DictationSection';
import { engineConditions } from '../settings/engine-conditions';
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
import { useRevealSection } from '../settings/use-reveal-section';
import type { NavTarget } from '../navigation';

export function Settings({ target, onNavigate }: { target: NavTarget; onNavigate: (target: NavTarget) => void }) {
  const settings = useSettings();
  const models = useModels();
  const server = useServer();
  const permissions = usePermissions();
  useRevealSection(target, settings.kind === 'ready');
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
  const serverView = server.kind === 'ready' ? server.value : null;
  const activeModel = models.catalog.kind === 'ready' ? (models.catalog.value.models.find((model) => model.id === value.localModelId) ?? null) : null;
  return (
    <div className="groups">
      <SaveErrorNotice />
      <DictationSection settings={value} activeModel={activeModel} />
      <EngineSection engineOrder={value.engineOrder} paired={(serverView?.server ?? null) !== null} conditions={engineConditions(value.localModelId, models, serverView)} serverHost={serverView?.server?.host ?? null} onNavigate={onNavigate} />
      <SettingsGroup title="Lokálny model" section="local-model">
        <LocalModelSection settings={value} models={models} />
      </SettingsGroup>
      <SettingsGroup title="Mikrofón" section="microphone">
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
