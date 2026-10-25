import { useState } from 'react';
import type { Live } from '../home/live-value';
import type { PermissionKind, PermissionsStatus } from '../../shared/permissions';
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

function RelaunchNotice() {
  return (
    <div className="relaunch" role="status">
      <p>Ak ste monitorovanie vstupu už povolili a stav sa nezmenil, macOS ho uplatní až po reštarte aplikácie.</p>
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

export function InputPermissionsStep({ permissions }: { permissions: Live<PermissionsStatus> }) {
  const [askedForInput, setAskedForInput] = useState(false);
  if (permissions.kind !== 'ready') {
    return null;
  }
  const { inputMonitoring, accessibility } = permissions.value;
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
      {askedForInput && !inputMonitoring && <RelaunchNotice />}
    </>
  );
}
