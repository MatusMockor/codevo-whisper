import { useState } from 'react';
import { LockIcon, ServerIcon } from '../components/Icons';
import { CommandBox } from '../server/CommandBox';
import { PairingCard } from '../server/PairingCard';
import { ServerCard } from '../server/ServerCard';
import { STORAGE_WARNINGS } from '../server/server-copy';
import { useServer } from '../server/use-server';
import { useSettings } from '../settings/use-settings';

function Introduction() {
  return (
    <div className="card">
      <div className="srv-top">
        <span className="srv-ic">
          <ServerIcon />
        </span>
        <div>
          <h2>Vlastný server</h2>
          <p>Zatiaľ nie je spárovaný žiadny server.</p>
        </div>
      </div>
      <p className="srv-text">
        Codevo Whisper vie prepisovať aj na serveri, ktorý vlastníte, napríklad na domácom počítači s grafickou kartou. Zvuk sa zašifruje už na tomto Macu, prepis sa vracia
        šifrovane a server zvuk ani text zámerne neukladá.
      </p>
      <div className="e2e">
        <span className="e2e-badge">
          <LockIcon />
          End-to-end šifrované
        </span>
        <p>Cesta k serveru cez domácu sieť, WireGuard alebo Cloudflare tunel uvidí iba šifrované dáta.</p>
      </div>
    </div>
  );
}

function Disconnected({ command }: { command: string }) {
  return (
    <div className="card srv-notice" role="status">
      <p>Server je odpojený. Aby ho server úplne zabudol, spustite na serveri:</p>
      <CommandBox command={command} />
    </div>
  );
}

export function Server() {
  const server = useServer();
  const settings = useSettings();
  const [revoke, setRevoke] = useState<string | null>(null);
  if (server.kind === 'loading') {
    return null;
  }
  if (server.kind === 'failed') {
    return (
      <p className="load-error" role="alert">
        Stav servera sa nepodarilo načítať.
      </p>
    );
  }
  const view = server.value;
  const engineOrder = settings.kind === 'ready' ? settings.value.engineOrder : [];
  return (
    <div className="server">
      {view.storage !== 'available' && (
        <p className="srv-alert" role="alert">
          {STORAGE_WARNINGS[view.storage]}
        </p>
      )}
      {revoke !== null && view.server === null && <Disconnected command={revoke} />}
      {view.server === null ? <Introduction /> : <ServerCard server={view.server} engineOrder={engineOrder} onDisconnected={setRevoke} />}
      <PairingCard key={view.server?.deviceId ?? 'unpaired'} pairing={view.pairing} storage={view.storage} replacing={view.server !== null} />
    </div>
  );
}
