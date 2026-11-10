import { useState } from 'react';
import { revokeCommand, type PairedServerView } from '../../shared/server';
import type { EngineId } from '../../shared/settings';
import { Glyph } from '../components/Glyph';
import { Led } from '../components/Led';
import type { SignalState } from '../home/transcription-route';
import { CommandBox } from './CommandBox';
import { pairedOn, statusPill, type PillTone } from './server-copy';
import { ServerStatePanel } from './ServerStatePanel';
import { useServerToggle } from './ServerToggle';

type ServerCardProps = {
  server: PairedServerView;
  restoreOrder: readonly EngineId[] | null;
  localReady: boolean;
  pairingOpen: boolean;
  onTogglePairing: () => void;
  onUnpaired: (command: string | null) => void;
  onDownloadModel: () => void;
};

const PILL_LEDS: Readonly<Record<PillTone, SignalState>> = Object.freeze({ ok: 'ok', err: 'err', amber: 'warn', muted: 'off' });

function UnpairConfirm({ server, onCancel, onUnpaired }: { server: PairedServerView; onCancel: () => void; onUnpaired: (command: string | null) => void }) {
  const [failed, setFailed] = useState(false);

  function unpair(): void {
    window.codevo.disconnectServer().then(
      (result) => onUnpaired(result.revokeCommand),
      (error: unknown) => {
        console.error('Unpairing the server failed', error);
        setFailed(true);
      },
    );
  }

  return (
    <div className="confirm">
      <p>
        <b>Zrušiť párovanie s {server.host}?</b> Zmaže sa párovanie a kľúče na tomto počítači a server sa odoberie z trasy prepisu. Ak server chcete iba dočasne nepoužívať, radšej ho
        odpojte tlačidlom Odpojiť, párovanie tak zostane. Server bude toto zariadenie poznať, kým ho na ňom neodvoláte:
      </p>
      <CommandBox command={revokeCommand(server.deviceId, navigator.userAgent.includes('Linux'))} />
      {failed && (
        <p className="field-note warn" role="alert">
          Párovanie sa nepodarilo zrušiť.
        </p>
      )}
      <div className="row-btns">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Ponechať
        </button>
        <button type="button" className="btn danger" onClick={unpair}>
          Áno, zrušiť párovanie
        </button>
      </div>
    </div>
  );
}

function Latency({ server }: { server: PairedServerView }) {
  if (server.status.kind === 'online') {
    return (
      <div className="latency">
        <span className="label-mono">Pripojenie</span>
        <span className="big">
          {server.status.connectMs}
          <small>ms</small>
        </span>
        <span className="latency-note">čas na nadviazanie šifrovaného spojenia</span>
      </div>
    );
  }
  return (
    <div className="latency pending">
      <span className="label-mono">Pripojenie</span>
      <span className="latency-note">Overujem spojenie so serverom…</span>
    </div>
  );
}

function showsLatency(server: PairedServerView): boolean {
  return server.enabled && (server.status.kind === 'online' || server.status.kind === 'checking' || server.status.kind === 'unknown');
}

function Details({ server }: { server: PairedServerView }) {
  return (
    <dl className="kv">
      <dt>Adresa</dt>
      <dd>{server.endpoint}</dd>
      <dt>Toto zariadenie</dt>
      <dd>
        {server.deviceName} ({server.deviceId})
      </dd>
      {server.status.kind === 'online' && (
        <>
          <dt>Verzia servera</dt>
          <dd>{server.status.serverVersion}</dd>
        </>
      )}
    </dl>
  );
}

export function ServerCard({ server, restoreOrder, localReady, pairingOpen, onTogglePairing, onUnpaired, onDownloadModel }: ServerCardProps) {
  const [confirming, setConfirming] = useState(false);
  const toggle = useServerToggle({ connected: server.enabled, localReady });
  const pill = statusPill(server);
  const latency = showsLatency(server);
  return (
    <article className={server.enabled ? 'card server-card' : 'card server-card is-off'}>
      <header className="srv-top">
        <span className="srv-ic">
          <Glyph name="server" size="lg" />
          <Led state={PILL_LEDS[pill.tone]} />
        </span>
        <div className="srv-id">
          <h3>{server.host}</h3>
          <p>{pairedOn(server.pairedAt)}</p>
        </div>
        <span className={`pill ${pill.tone}`}>
          <Led state={PILL_LEDS[pill.tone]} />
          {pill.label}
        </span>
        {toggle.control}
      </header>
      {toggle.notice}
      <ServerStatePanel server={server} restoreOrder={restoreOrder} localReady={localReady} onDownloadModel={onDownloadModel} />
      <div className={latency ? 'srv-grid' : 'srv-grid single'}>
        {latency && <Latency server={server} />}
        <div className="srv-facts">
          <Details server={server} />
          <p className="e2e-line">
            <Glyph name="lock" size="sm" />
            Zvuk sa šifruje už na tomto počítači a prepis sa vracia šifrovane. Domáca sieť, VPN aj tunel prenášajú iba šifrované dáta.
          </p>
        </div>
      </div>
      <div className="fps">
        <div className="fpbox">
          <small>Odtlačok kľúča servera</small>
          <code>{server.serverFingerprint}</code>
        </div>
        <div className="fpbox">
          <small>Odtlačok tohto zariadenia (ukazuje ho aj codevo-whisper devices)</small>
          <code data-fingerprint="device">{server.deviceFingerprint}</code>
        </div>
      </div>
      <footer className="srv-actions">
        <div className="row-btns">
          {server.enabled && server.status.kind !== 'offline' && server.status.kind !== 'unavailable' && (
            <button type="button" className="btn" disabled={server.status.kind === 'checking'} onClick={() => void window.codevo.checkServer()}>
              <Glyph name="refresh" size="sm" />
              Otestovať spojenie
            </button>
          )}
          {server.status.kind !== 'repair-needed' && (
            <button type="button" className="btn ghost" aria-expanded={pairingOpen} onClick={onTogglePairing}>
              <Glyph name={pairingOpen ? 'x' : 'plus'} size="sm" />
              {pairingOpen ? 'Zavrieť párovanie' : 'Spárovať iný server'}
            </button>
          )}
        </div>
        <button type="button" className="btn danger subtle" disabled={confirming} onClick={() => setConfirming(true)}>
          Zrušiť párovanie
        </button>
      </footer>
      {confirming && <UnpairConfirm server={server} onCancel={() => setConfirming(false)} onUnpaired={onUnpaired} />}
    </article>
  );
}
