import { useCallback, useEffect, useState } from 'react';
import type { EngineId } from '../../shared/settings';
import { switchEngine } from './prefer-engine';

const VISIBLE_MS = 8000;

export type EngineSwitchControl = { failure: string | null; prefer: (engine: EngineId) => void };

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

  return { failure, prefer };
}
