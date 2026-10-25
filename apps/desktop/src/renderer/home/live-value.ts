import { useEffect, useState } from 'react';
import type { IpcEventName, IpcEvents } from '../../shared/ipc-contract';

export type Live<T> = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; value: T };

export function liveValueOr<T>(live: Live<T>, fallback: T): T {
  return live.kind === 'ready' ? live.value : fallback;
}

export function useLiveValue<E extends IpcEventName>(event: E, load: () => Promise<IpcEvents[E]>): Live<IpcEvents[E]> {
  const [live, setLive] = useState<Live<IpcEvents[E]>>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    let pushed = false;
    const unsubscribe = window.codevo.on(event, (value) => {
      pushed = true;
      setLive({ kind: 'ready', value });
    });
    load().then(
      (value) => {
        if (!active || pushed) {
          return;
        }
        setLive({ kind: 'ready', value });
      },
      (error: unknown) => {
        console.error(`Loading ${event} data failed`, error);
        if (!active || pushed) {
          return;
        }
        setLive({ kind: 'failed' });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [event, load]);

  return live;
}
