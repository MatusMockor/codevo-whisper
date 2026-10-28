import type { PairedServerView } from '../../shared/server';
import { PairingCard } from '../server/PairingCard';
import { REPAIR_MESSAGES, STORAGE_WARNINGS } from '../server/server-copy';
import { useServer } from '../server/use-server';
import { serverNeedsPairing } from './engine-choice';

function PairedStatus({ server }: { server: PairedServerView }) {
  if (server.status.kind === 'repair-needed') {
    return (
      <p className="srv-alert" role="alert">
        {REPAIR_MESSAGES[server.status.reason]}
      </p>
    );
  }
  return (
    <p className="pair-ok" role="status">
      Spárované so serverom {server.host}. Prepisovať bude tento server.
    </p>
  );
}

export function ServerChoice() {
  const server = useServer();
  if (server.kind === 'loading') {
    return null;
  }
  if (server.kind === 'failed') {
    return (
      <p className="field-note warn" role="alert">
        Stav servera sa nepodarilo načítať.
      </p>
    );
  }
  const view = server.value;
  return (
    <>
      {view.storage !== 'available' && (
        <p className="srv-alert" role="alert">
          {STORAGE_WARNINGS[view.storage]}
        </p>
      )}
      {view.server !== null && <PairedStatus server={view.server} />}
      {serverNeedsPairing(view) && <PairingCard key={view.server?.deviceId ?? 'unpaired'} pairing={view.pairing} storage={view.storage} replacing={view.server !== null} />}
    </>
  );
}
