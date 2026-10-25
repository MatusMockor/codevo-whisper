import { useCallback, useEffect, useState } from 'react';
import type { Live } from '../home/live-value';
import type { PermissionsStatus } from '../../shared/permissions';

const POLL_MS = 1000;

export function usePermissions(): { permissions: Live<PermissionsStatus>; refresh: () => void } {
  const [permissions, setPermissions] = useState<Live<PermissionsStatus>>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    window.codevo.getPermissions().then(
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
