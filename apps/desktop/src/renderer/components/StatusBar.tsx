import type { AppStatus } from '../../shared/app-status';
import type { Live } from '../home/live-value';
import { readinessSummary } from '../home/readiness';
import { DEFAULT_MICROPHONE } from '../home/signal-path';
import type { Dictation } from '../home/use-dictation';
import type { TranscriptionRoute } from '../home/transcription-route';
import { Glyph } from './Glyph';
import { Led } from './Led';
import { StatusBarVersion } from './UpdateFooter';
import { UpdateIndicator } from './UpdateIndicator';

function ReadinessItem({ status }: { status: Live<AppStatus> }) {
  if (status.kind === 'loading') {
    return <div className="sbar-ready" />;
  }
  if (status.kind === 'failed') {
    return (
      <div className="sbar-ready">
        <Led state="err" />
        <b>Stav neznámy</b>
      </div>
    );
  }
  const readiness = readinessSummary(status.value);
  return (
    <div className="sbar-ready">
      <Led state={readiness.state} />
      <b>{readiness.label}</b>
      {readiness.hint !== null && <span>{readiness.hint}</span>}
    </div>
  );
}

function RouteItem({ route }: { route: TranscriptionRoute | null }) {
  if (route === null) {
    return null;
  }
  return (
    <div className="sbar-route">
      <Glyph name="route" size="sm" />
      <span>prepis →</span>
      <b>{route.state === 'err' ? 'nedostupný' : route.label}</b>
      {route.latencyMs !== null && <span>{route.latencyMs} ms</span>}
    </div>
  );
}

function MicrophoneItem({ dictation }: { dictation: Dictation }) {
  if (dictation.settings.kind !== 'ready') {
    return null;
  }
  return (
    <div className="sbar-mic">
      <Glyph name="mic" size="sm" />
      <span>{dictation.settings.value.microphone.label ?? DEFAULT_MICROPHONE}</span>
    </div>
  );
}

export function StatusBar({ dictation }: { dictation: Dictation }) {
  return (
    <footer className="sbar">
      <ReadinessItem status={dictation.status} />
      <RouteItem route={dictation.route} />
      <MicrophoneItem dictation={dictation} />
      <UpdateIndicator />
      <StatusBarVersion />
    </footer>
  );
}
