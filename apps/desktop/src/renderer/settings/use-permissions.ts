import { useCallback, useEffect, useState } from 'react';
import type { Live } from '../home/live-value';
import type { PermissionsView } from './permissions-view';

const POLL_MS = 1000;

async function loadPermissions(): Promise<PermissionsView> {
  const status = await window.codevo.getPermissions();
  const hotkeyArmed = await window.codevo.isHotkeyArmed();
  const guide = await window.codevo.getPermissionGuide();
  return { ...status, ...guide, hotkeyArmed };
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
