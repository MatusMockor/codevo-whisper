import type { ServerView } from '../../shared/server';
import type { Settings } from '../../shared/settings';
import { PageSection } from '../components/PageSection';
import type { Dictation } from '../home/use-dictation';
import { useRevealSection } from '../components/use-reveal-section';
import { MODEL_SECTION, type NavTarget } from '../navigation';
import { PairingNotice } from '../server/PairingNotice';
import { pairingNotice } from '../server/pairing-notice';
import { STORAGE_WARNINGS } from '../server/server-copy';
import { useDismissedNotices } from '../server/use-dismissed-notices';
import { useServer } from '../server/use-server';
import { engineConditions } from '../settings/engine-conditions';
import { SaveErrorNotice } from '../settings/SaveErrorNotice';
import { useEngineSwitch } from '../settings/use-engine-switch';
import { modelName, useModels, type Models } from '../settings/use-models';
import { saveSettings, useSettings } from '../settings/use-settings';
import { activeDownload, type EngineFacts } from '../transcription/engine-cards';
import { LocalModelSection } from '../transcription/LocalModelSection';
import { NowCard } from '../transcription/NowCard';
import { nowState, type NowState } from '../transcription/now-state';
import { readinessNote } from '../transcription/readiness-note';
import { RouteCard } from '../transcription/RouteCard';
import { ServerSection } from '../transcription/ServerSection';

type TranscriptionProps = { target: NavTarget; dictation: Dictation; onNavigate: (target: NavTarget) => void };

function engineFacts(settings: Settings, models: Models, view: ServerView): EngineFacts | null {
  const conditions = engineConditions(settings.localModelId, models, view);
  if (conditions === null) {
    return null;
  }
  return { server: view.server, local: { modelName: modelName(models, settings.localModelId), download: activeDownload(models.states) }, conditions };
}

type ContentProps = TranscriptionProps & { settings: Settings; view: ServerView; models: Models };

function TranscriptionContent({ settings, view, models, dictation, onNavigate }: ContentProps) {
  const engineSwitch = useEngineSwitch();
  const notices = useDismissedNotices();
  const facts = engineFacts(settings, models, view);
  const handlers = { navigate: onNavigate, prefer: engineSwitch.prefer, enableServer: engineSwitch.enableServer };
  const now: NowState | null = facts === null ? null : nowState(settings.engineOrder, facts);
  return (
    <>
      {view.storage !== 'available' && (
        <p className="srv-panel err" role="alert">
          {STORAGE_WARNINGS[view.storage]}
        </p>
      )}
      <SaveErrorNotice />
      <PairingNotice notice={pairingNotice(view, settings.engineOrder, notices.dismissed)} onDismiss={notices.dismiss} />
      {now !== null && <NowCard state={now} note={readinessNote(dictation.status.kind === 'ready' ? dictation.status.value : null, dictation.issue, now.tone)} serverHost={view.server?.host ?? null} handlers={handlers} failure={engineSwitch.failure} />}
      <PageSection index="01" title="Trasa prepisu" hint="Hlavný prepis sa použije vždy, keď je pripravený. Záloha iba vtedy, keď nie je." section="engine">
        {facts !== null && <RouteCard order={settings.engineOrder} facts={facts} onChange={(engineOrder) => saveSettings({ engineOrder })} onNavigate={onNavigate} />}
      </PageSection>
      <PageSection index="02" title="Vlastný server" hint="Párovanie, stav spojenia a odtlačky kľúčov." section="server">
        <ServerSection view={view} restoreOrder={settings.serverRestoreOrder} localReady={facts?.conditions.localReady ?? false} onDownloadModel={() => onNavigate(MODEL_SECTION)} />
      </PageSection>
      <PageSection index="03" title="Lokálny model" hint="Prepis priamo na tomto počítači, aj bez internetu." section="local-model">
        <LocalModelSection settings={settings} models={models} />
      </PageSection>
    </>
  );
}

export function Transcription({ target, dictation, onNavigate }: TranscriptionProps) {
  const settings = useSettings();
  const server = useServer();
  const models = useModels();
  useRevealSection(target, settings.kind === 'ready' && server.kind === 'ready');
  if (settings.kind === 'loading' || server.kind === 'loading') {
    return null;
  }
  if (settings.kind === 'failed' || server.kind === 'failed') {
    return (
      <p className="load-error" role="alert">
        Nastavenie prepisu sa nepodarilo načítať.
      </p>
    );
  }
  return (
    <div className="page">
      <TranscriptionContent target={target} dictation={dictation} onNavigate={onNavigate} settings={settings.value} view={server.value} models={models} />
    </div>
  );
}
