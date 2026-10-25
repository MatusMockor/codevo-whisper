import { useState } from 'react';
import type { Live } from '../home/live-value';
import type { PermissionKind } from '../../shared/permissions';
import type { PermissionsView } from '../settings/use-permissions';
import { PermissionRow } from './PermissionRow';

function grantLabel(granted: boolean): string {
  return granted ? 'Povolené' : 'Zatiaľ nepovolené';
}

function openPermission(kind: PermissionKind): void {
  window.codevo
    .requestPermission(kind)
    .then(() => window.codevo.openPermissionSettings(kind))
    .catch((error: unknown) => {
      console.error(`Opening the ${kind} settings failed`, error);
    });
}

const RELAUNCH_MESSAGES = {
  pending: 'Ak ste monitorovanie vstupu už povolili a stav sa nezmenil, macOS ho uplatní až po reštarte aplikácie.',
  unarmed: 'Monitorovanie vstupu je povolené, ale klávesová skratka zatiaľ nereaguje. macOS ju sprístupní po reštarte aplikácie.',
} as const;

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

export function InputPermissionsStep({ permissions }: { permissions: Live<PermissionsView> }) {
  const [askedForInput, setAskedForInput] = useState(false);
  if (permissions.kind !== 'ready') {
    return null;
  }
  const { inputMonitoring, accessibility, hotkeyArmed } = permissions.value;
  const needsRelaunch = (askedForInput && !inputMonitoring) || (inputMonitoring && !hotkeyArmed);
  return (
    <>
      <div className="sbox">
        <PermissionRow
          title="Monitorovanie vstupu"
          description="Aplikácia sleduje iba vybraný kláves, aby vedela, kedy diktujete."
          granted={inputMonitoring}
          statusLabel={grantLabel(inputMonitoring)}
          actionLabel="Otvoriť Nastavenia systému"
          onAction={() => {
            setAskedForInput(true);
            openPermission('input-monitoring');
          }}
        />
        <PermissionRow
          title="Prístupnosť"
          description="Umožní vložiť prepísaný text do aplikácie, v ktorej práve píšete."
          granted={accessibility}
          statusLabel={grantLabel(accessibility)}
          actionLabel="Otvoriť Nastavenia systému"
          onAction={() => openPermission('accessibility')}
        />
      </div>
      {needsRelaunch && <RelaunchNotice message={inputMonitoring ? RELAUNCH_MESSAGES.unarmed : RELAUNCH_MESSAGES.pending} />}
    </>
  );
}
