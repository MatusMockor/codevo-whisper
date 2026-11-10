import { useCallback, useEffect, useState } from 'react';
import type { EngineId } from '../../shared/settings';
import { ENABLE_FAILED_MESSAGE, switchEngine } from './prefer-engine';

const VISIBLE_MS = 8000;

export type EngineSwitchControl = { failure: string | null; prefer: (engine: EngineId) => void; enableServer: () => void };

export function useEngineSwitch(): EngineSwitchControl {
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (failure === null) {
      return;
    }
    const timer = setTimeout(() => setFailure(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [failure]);

  const prefer = useCallback((engine: EngineId) => {
    setFailure(null);
    void switchEngine(engine, window.codevo).then(setFailure);
  }, []);

  const enableServer = useCallback(() => {
    setFailure(null);
    window.codevo.setServerEnabled(true).catch((error: unknown) => {
      console.error('Switching the server on failed', error);
      setFailure(ENABLE_FAILED_MESSAGE);
    });
  }, []);

  return { failure, prefer, enableServer };
}
