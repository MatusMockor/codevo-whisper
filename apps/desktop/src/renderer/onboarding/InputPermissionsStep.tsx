import { useState } from 'react';
import type { Live } from '../home/live-value';
import type { InputPermissionKind } from '../../shared/permissions';
import type { PermissionsView } from '../settings/permissions-view';
import { inputPermissionAction, isGranted, offersManualAdd, relaunchReason, type InputPermissionAction, type RelaunchReason } from './input-permission-flow';
import { PermissionRow } from './PermissionRow';

type InputPermissionCopy = { kind: InputPermissionKind; title: string; description: string };

const INPUT_PERMISSIONS: readonly InputPermissionCopy[] = [
  { kind: 'input-monitoring', title: 'Monitorovanie vstupu', description: 'Aplikácia sleduje iba vybraný kláves, aby vedela, kedy diktujete.' },
  { kind: 'accessibility', title: 'Prístupnosť', description: 'Umožní vložiť prepísaný text do aplikácie, v ktorej práve píšete.' },
];

const RELAUNCH_MESSAGES: Readonly<Record<RelaunchReason, string>> = {
  pending: 'Ak ste monitorovanie vstupu už povolili a stav sa nezmenil, macOS ho uplatní až po reštarte aplikácie.',
  unarmed: 'Monitorovanie vstupu je povolené, ale klávesová skratka zatiaľ nereaguje. macOS ju sprístupní po reštarte aplikácie.',
};

function grantLabel(granted: boolean): string {
  return granted ? 'Povolené' : 'Zatiaľ nepovolené';
}

function runAction(kind: InputPermissionKind, action: InputPermissionAction): Promise<void> {
  const run = action.run === 'request' ? window.codevo.requestPermission(kind) : window.codevo.openPermissionSettings(kind);
  return run.catch((error: unknown) => {
    console.error(`The ${kind} permission action failed`, error);
  });
}

function ManualAddHint() {
  return (
    <div className="perm-manual">
      <p>Ak tam Codevo Whisper nie je, kliknite v zozname na + a vyberte ju, alebo ju tam presuňte z Findera.</p>
      <button
        type="button"
        className="btn"
        onClick={() => {
          window.codevo.revealAppInFinder().catch((error: unknown) => {
            console.error('Revealing the app in Finder failed', error);
          });
        }}
      >
        Zobraziť vo Finderi
      </button>
    </div>
  );
}

function InputPermission({ copy, view, refresh }: { copy: InputPermissionCopy; view: PermissionsView; refresh: () => void }) {
  const granted = isGranted(view, copy.kind);
  const action = inputPermissionAction(view, copy.kind);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PermissionRow
        title={copy.title}
        description={copy.description}
        granted={granted}
        statusLabel={grantLabel(granted)}
        actionLabel={action.label}
        busy={busy}
        onAction={() => {
          setBusy(true);
          void runAction(copy.kind, action).finally(() => {
            setBusy(false);
            refresh();
          });
        }}
      />
      {offersManualAdd(view, copy.kind) && <ManualAddHint />}
    </>
  );
}

function RelaunchNotice({ message }: { message: string }) {
  return (
    <div className="relaunch" role="status">
      <p>{message}</p>
      <button
        type="button"
        className="btn primary"
        onClick={() => {
          window.codevo.relaunch().catch((error: unknown) => {
            console.error('The relaunch failed', error);
          });
        }}
      >
        Reštartovať
      </button>
    </div>
  );
}

export function InputPermissionsStep({ permissions, refresh }: { permissions: Live<PermissionsView>; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  if (permissions.kind !== 'ready') {
    return null;
  }
  if (permissions.value.platform === 'linux') {
    return <div className="sbox">
      <PermissionRow title="Prístup ku klávesnici" description="X11 používa systémové skratky. Wayland vyžaduje prístup na čítanie ku klávesniciam aktívneho používateľa. Aplikácia nemení oprávnenia zariadení." granted={permissions.value.inputMonitoring} statusLabel={grantLabel(permissions.value.inputMonitoring)} actionLabel="Skontrolovať znova" onAction={refresh} />
      <PermissionRow title="Rozpoznávanie textových polí" description="Povolí systémovú prístupnosť, aby aplikácia vedela overiť, kam vkladá text. Čítačka obrazovky sa nezapne." granted={permissions.value.accessibility} statusLabel={grantLabel(permissions.value.accessibility)} actionLabel="Povoliť rozpoznávanie polí" busy={busy} onAction={() => {
        setBusy(true);
        setPermissionError(null);
        void window.codevo.requestPermission('accessibility').then(() => window.codevo.getPermissions()).then((status) => {
          if (!status.accessibility) setPermissionError('Rozpoznávanie polí sa nepodarilo povoliť. Skúste to znova.');
          refresh();
        }).catch(() => setPermissionError('Rozpoznávanie polí sa nepodarilo povoliť. Skúste to znova.')).finally(() => setBusy(false));
      }} />
      {permissionError !== null && <p role="alert" className="sbox-foot">{permissionError}</p>}
      <p className="sbox-foot">Po zmene medzi X11 a Waylandom nahrajte skratku znova. Vo Waylande je text v schránke na ručné vloženie; vyžaduje XWayland a jeho most schránky. Poloha a zobrazenie okna závisia od kompozítora.</p>
      <p className="sbox-foot">{permissions.value.accessibility ? 'Rozpoznávanie polí je povolené. Dostupnosť automatického vloženia závisí od cieľovej aplikácie.' : 'Prepis zostane dostupný v schránke aj bez rozpoznávania polí.'}</p>
    </div>;
  }
  const reason = relaunchReason(permissions.value);
  return (
    <>
      <div className="sbox">
        {INPUT_PERMISSIONS.map((copy) => (
          <InputPermission key={copy.kind} copy={copy} view={permissions.value} refresh={refresh} />
        ))}
      </div>
      {reason !== null && <RelaunchNotice message={RELAUNCH_MESSAGES[reason]} />}
    </>
  );
}
