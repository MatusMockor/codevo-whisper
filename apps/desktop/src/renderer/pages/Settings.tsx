import { Glyph } from '../components/Glyph';
import { MicrophonePicker } from '../components/MicrophonePicker';
import { useRevealSection } from '../components/use-reveal-section';
import { ENGINE_SECTION, type NavTarget } from '../navigation';
import { InputPermissionsStep } from '../onboarding/InputPermissionsStep';
import { AiSection } from '../settings/AiSection';
import { DictationSection } from '../settings/DictationSection';
import { HistorySection } from '../settings/HistorySection';
import { InsertionSection } from '../settings/InsertionSection';
import { SaveErrorNotice } from '../settings/SaveErrorNotice';
import { SettingsGroup } from '../settings/SettingsGroup';
import { SystemSection } from '../settings/SystemSection';
import { TranscriptSection } from '../settings/TranscriptSection';
import { useModels } from '../settings/use-models';
import { usePermissions } from '../settings/use-permissions';
import { saveSettings, useSettings } from '../settings/use-settings';

function MovedToTranscription({ onNavigate }: { onNavigate: (target: NavTarget) => void }) {
  return (
    <button type="button" className="moved" onClick={() => onNavigate(ENGINE_SECTION)}>
      <Glyph name="route" />
      <span>
        <b>Kde beží prepis</b>
        Server, poradie prepisu a lokálny model nájdete na stránke Prepis.
      </span>
    </button>
  );
}

export function Settings({ target, onNavigate }: { target: NavTarget; onNavigate: (target: NavTarget) => void }) {
  const settings = useSettings();
  const models = useModels();
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
  const activeModel = models.catalog.kind === 'ready' ? (models.catalog.value.models.find((model) => model.id === value.localModelId) ?? null) : null;
  return (
    <div className="groups">
      <SaveErrorNotice />
      <MovedToTranscription onNavigate={onNavigate} />
      <DictationSection settings={value} activeModel={activeModel} />
      <SettingsGroup title="Mikrofón" section="microphone">
        <MicrophonePicker microphone={value.microphone} onChange={(microphone) => saveSettings({ microphone })} />
      </SettingsGroup>
      <InsertionSection settings={value} />
      {permissions.permissions.kind === 'ready' && permissions.permissions.value.platform === 'linux' && (
        <SettingsGroup title="Prístup k systému">
          <InputPermissionsStep permissions={permissions.permissions} refresh={permissions.refresh} />
        </SettingsGroup>
      )}
      <TranscriptSection settings={value} />
      <AiSection settings={value} />
      <HistorySection />
      <SystemSection launchAtLogin={value.launchAtLogin} />
    </div>
  );
}
