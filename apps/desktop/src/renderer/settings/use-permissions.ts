import { useCallback, useEffect, useState } from 'react';
import type { Live } from '../home/live-value';
import type { PermissionsStatus } from '../../shared/permissions';

const POLL_MS = 1000;

export type PermissionsView = PermissionsStatus & { hotkeyArmed: boolean };

function loadPermissions(): Promise<PermissionsView> {
  return Promise.all([window.codevo.getPermissions(), window.codevo.isHotkeyArmed()]).then(([status, hotkeyArmed]) => ({ ...status, hotkeyArmed }));
}

export function usePermissions(): { permissions: Live<PermissionsView>; refresh: () => void } {
  const [permissions, setPermissions] = useState<Live<PermissionsView>>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    loadPermissions().then(
      (value) => {
        if (active) {
          setPermissions({ kind: 'ready', value });
        }
      },
      (error: unknown) => {
        console.error('Reading the permissions failed', error);
        if (active) {
          setPermissions({ kind: 'failed' });
        }
      },
    );
    const timer = setTimeout(refresh, POLL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [tick, refresh]);

  return { permissions, refresh };
}
