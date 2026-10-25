import { useState } from 'react';
import { LockIcon, ServerIcon } from '../components/Icons';
import { revokeCommand, type PairedServerView } from '../../shared/server';
import type { EngineId } from '../../shared/settings';
import { saveSettings } from '../settings/use-settings';
import { CommandBox } from './CommandBox';
import { connectTime, pairedOn, REPAIR_MESSAGES, statusPill } from './server-copy';

type ServerCardProps = { server: PairedServerView; engineOrder: readonly EngineId[]; onDisconnected: (command: string | null) => void };

function DisconnectConfirm({ server, onCancel, onDisconnected }: { server: PairedServerView; onCancel: () => void; onDisconnected: (command: string | null) => void }) {
  const [failed, setFailed] = useState(false);

  function disconnect(): void {
    window.codevo.disconnectServer().then(
      (result) => onDisconnected(result.revokeCommand),
      (error: unknown) => {
        console.error('Disconnecting the server failed', error);
        setFailed(true);
      },
    );
  }

  return (
    <div className="confirm">
      <p>Zmaže sa iba párovanie na tomto Macu a prepis sa prepne na Lokálne. Server bude toto zariadenie poznať, kým ho na ňom neodvoláte:</p>
      <CommandBox command={revokeCommand(server.deviceId)} />
      {failed && (
        <p className="field-note warn" role="alert">
          Server sa nepodarilo odpojiť.
        </p>
      )}
      <div className="row-btns">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Zrušiť
        </button>
        <button type="button" className="btn danger" onClick={disconnect}>
          Áno, odpojiť
        </button>
      </div>
    </div>
  );
}

function UseServer({ engineOrder }: { engineOrder: readonly EngineId[] }) {
  if (engineOrder.includes('server')) {
    return null;
  }
  return (
    <div className="use-server">
      <p>Prepis zatiaľ beží lokálne na tomto Macu.</p>
      <button type="button" className="btn primary" onClick={() => saveSettings({ engineOrder: ['server', 'local'] })}>
        Prepisovať na serveri
      </button>
    </div>
  );
}

export function ServerCard({ server, engineOrder, onDisconnected }: ServerCardProps) {
  const [confirming, setConfirming] = useState(false);
  const pill = statusPill(server.status);
  return (
    <div className="card server-card">
      <div className="srv-top">
        <span className="srv-ic">
          <ServerIcon />
        </span>
        <div>
          <h2>{server.host}</h2>
          <p>{pairedOn(server.pairedAt)}</p>
        </div>
        <span className={`pill ${pill.tone}`}>{pill.label}</span>
      </div>
      {server.status.kind === 'repair-needed' && (
        <p className="srv-alert" role="alert">
          {REPAIR_MESSAGES[server.status.reason]}
        </p>
      )}
      <div className="e2e">
        <span className="e2e-badge">
          <LockIcon />
          End-to-end šifrované
        </span>
        <p>Zvuk aj text sa šifrujú už na tomto Macu. Domáca sieť, VPN aj tunel prenášajú iba šifrované dáta a nevedia ich prečítať.</p>
      </div>
      <dl className="kv">
        <div>
          <dt>Pripojenie</dt>
          <dd>{connectTime(server.status)}</dd>
        </div>
        <div>
          <dt>Adresa</dt>
          <dd>{server.endpoint}</dd>
        </div>
        <div>
          <dt>Toto zariadenie</dt>
          <dd>
            {server.deviceName} ({server.deviceId})
          </dd>
        </div>
        <div>
          <dt>Verzia servera</dt>
          <dd>{server.status.kind === 'online' ? server.status.serverVersion : '–'}</dd>
        </div>
      </dl>
      <p className="note">Pripojenie je čas, za ktorý sa nadviaže šifrované spojenie so serverom.</p>
      <UseServer engineOrder={engineOrder} />
      <div className="fp">
        <div>
          <small>Odtlačok kľúča servera</small>
          <code>{server.serverFingerprint}</code>
        </div>
        <div className="row-btns">
          <button type="button" className="btn" disabled={server.status.kind === 'checking'} onClick={() => void window.codevo.checkServer()}>
            Otestovať spojenie
          </button>
          <button type="button" className="btn danger" disabled={confirming} onClick={() => setConfirming(true)}>
            Odpojiť server
          </button>
        </div>
      </div>
      {confirming && <DisconnectConfirm server={server} onCancel={() => setConfirming(false)} onDisconnected={onDisconnected} />}
    </div>
  );
}
