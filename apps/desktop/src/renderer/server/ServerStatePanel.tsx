import type { PairedServerView } from '../../shared/server';
import type { EngineId } from '../../shared/settings';
import { Glyph } from '../components/Glyph';
import { routeText } from '../transcription/route-order';
import { REPAIR_MESSAGES, UNAVAILABLE_MESSAGES, unreachableHint } from './server-copy';

type PanelProps = { server: PairedServerView; restoreOrder: readonly EngineId[] | null; localReady: boolean; onDownloadModel: () => void };

function Unreachable({ server }: { server: PairedServerView }) {
  return (
    <div className="srv-panel err" role="status">
      <Glyph name="plug" />
      <div>
        <b>Server neodpovedá</b>
        <p>
          Codevo Whisper sa nevie spojiť so serverom na adrese <code>{server.endpoint}</code>. {unreachableHint(server.endpoint)}
        </p>
        <p className="srv-panel-note">Aplikácia to skúša znova sama, aj po prebudení počítača.</p>
      </div>
      <RetryButton />
    </div>
  );
}

function RetryButton() {
  return (
    <button type="button" className="btn" onClick={() => void window.codevo.checkServer()}>
      <Glyph name="refresh" size="sm" />
      Skúsiť znova
    </button>
  );
}

function Unavailable({ reason }: { reason: keyof typeof UNAVAILABLE_MESSAGES }) {
  const message = UNAVAILABLE_MESSAGES[reason];
  return (
    <div className={reason === 'busy' ? 'srv-panel amber' : 'srv-panel err'} role="status">
      <Glyph name="warn" />
      <div>
        <b>{message.title}</b>
        <p>{message.text}</p>
        <p className="srv-panel-note">Aplikácia to skúša znova sama.</p>
      </div>
      <RetryButton />
    </div>
  );
}

function restoreNote(restoreOrder: readonly EngineId[] | null): string {
  if (restoreOrder === null || !restoreOrder.includes('server')) {
    return 'Po pripojení ho znova pridáte do trasy prepisu vyššie.';
  }
  return `Po pripojení sa obnoví trasa ${routeText(restoreOrder).title}.`;
}

function Disconnected({ restoreOrder, localReady, onDownloadModel }: Omit<PanelProps, 'server'>) {
  return (
    <div className="srv-panel off" role="status">
      <Glyph name="plug" />
      <div>
        <b>Server je odpojený</b>
        <p>
          Codevo Whisper sa k nemu nepripája a neposiela naň zvuk. Párovanie aj kľúče zostávajú uložené, takže tlačidlo Pripojiť ho znova pripojí bez nového párovania.{' '}
          {restoreNote(restoreOrder)}
        </p>
        {!localReady && <p className="srv-panel-warn">Lokálny model nemáte stiahnutý, takže kým je server odpojený, diktovanie nefunguje.</p>}
      </div>
      {!localReady && (
        <button type="button" className="btn" onClick={onDownloadModel}>
          Stiahnuť model
        </button>
      )}
    </div>
  );
}

export function ServerStatePanel(props: PanelProps) {
  const { server } = props;
  if (!server.enabled) {
    return <Disconnected {...props} />;
  }
  if (server.status.kind === 'repair-needed') {
    return (
      <div className="srv-panel err" role="alert">
        <Glyph name="warn" />
        <p>{REPAIR_MESSAGES[server.status.reason]}</p>
      </div>
    );
  }
  if (server.status.kind === 'offline') {
    return <Unreachable server={server} />;
  }
  if (server.status.kind === 'unavailable') {
    return <Unavailable reason={server.status.reason} />;
  }
  return null;
}
