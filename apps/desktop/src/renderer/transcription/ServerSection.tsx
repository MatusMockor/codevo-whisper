import { useState } from 'react';
import type { PairingView, ServerView } from '../../shared/server';
import type { EngineId } from '../../shared/settings';
import { Glyph } from '../components/Glyph';
import { CommandBox } from '../server/CommandBox';
import { PairingCard } from '../server/PairingCard';
import { ServerCard } from '../server/ServerCard';

type ServerSectionProps = { view: ServerView; restoreOrder: readonly EngineId[] | null; localReady: boolean; onDownloadModel: () => void };

function Unpaired({ command }: { command: string }) {
  return (
    <div className="srv-panel amber" role="status">
      <Glyph name="plug" />
      <div>
        <b>Párovanie je zrušené</b>
        <p>Aby server toto zariadenie úplne zabudol, spustite na serveri:</p>
        <CommandBox command={command} />
      </div>
    </div>
  );
}

function Introduction({ view, localReady }: { view: ServerView; localReady: boolean }) {
  return (
    <div className="card srv-intro page-split">
      <div className="srv-intro-text">
        <div className="srv-top">
          <span className="srv-ic">
            <Glyph name="server" size="lg" />
          </span>
          <div className="srv-id">
            <h3>Vlastný server</h3>
            <p>Zatiaľ nie je spárovaný žiadny server.</p>
          </div>
        </div>
        <p>
          Codevo Whisper vie prepisovať aj na serveri, ktorý vlastníte, napríklad na domácom počítači s grafickou kartou. Zvuk sa zašifruje už na tomto počítači, prepis sa vracia
          šifrovane a server zvuk ani text zámerne neukladá.
        </p>
        <p className="e2e-line">
          <Glyph name="lock" size="sm" />
          Cesta k serveru cez domácu sieť, WireGuard alebo Cloudflare tunel uvidí iba šifrované dáta.
        </p>
        <p className="note">
          <Glyph name="route" size="sm" />
          {localReady ? 'Po spárovaní vám ponúkneme nastaviť server ako hlavný prepis.' : 'Po spárovaní sa prepis prepne na server automaticky, lebo lokálny model nemáte stiahnutý.'}
        </p>
      </div>
      <PairingCard pairing={view.pairing} storage={view.storage} replacing={false} />
    </div>
  );
}

function pairingInProgress(pairing: PairingView): boolean {
  return pairing.kind === 'connecting' || pairing.kind === 'awaiting-approval';
}

export function ServerSection({ view, restoreOrder, localReady, onDownloadModel }: ServerSectionProps) {
  const [revoke, setRevoke] = useState<string | null>(null);
  const [pairingOpen, setPairingOpen] = useState(false);
  const server = view.server;
  if (server === null) {
    return (
      <>
        {revoke !== null && <Unpaired command={revoke} />}
        <Introduction view={view} localReady={localReady} />
      </>
    );
  }
  const showPairing = pairingOpen || server.status.kind === 'repair-needed' || pairingInProgress(view.pairing);
  return (
    <>
      <ServerCard
        server={server}
        restoreOrder={restoreOrder}
        localReady={localReady}
        pairingOpen={showPairing}
        onTogglePairing={() => setPairingOpen(!showPairing)}
        onUnpaired={setRevoke}
        onDownloadModel={onDownloadModel}
      />
      {showPairing && <PairingCard key={server.deviceId} pairing={view.pairing} storage={view.storage} replacing />}
    </>
  );
}
