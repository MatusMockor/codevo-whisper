import { useEffect, useState } from 'react';
import type { IpcEventName, IpcEvents } from '../../shared/ipc-contract';

export function useLiveValue<E extends IpcEventName>(event: E, load: () => Promise<IpcEvents[E]>): IpcEvents[E] | null {
  const [value, setValue] = useState<IpcEvents[E] | null>(null);

  useEffect(() => {
    let active = true;
    let pushed = false;
    const unsubscribe = window.codevo.on(event, (next) => {
      pushed = true;
      setValue(next);
    });
    load()
      .then((initial) => {
        if (!active || pushed) {
          return;
        }
        setValue(initial);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [event, load]);

  return value;
}

export function useLastTranscript(): string | null {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = (): void => {
      window.codevo
        .getLastTranscript()
        .then((latest) => {
          if (!active) {
            return;
          }
          setText(latest);
        })
        .catch(() => undefined);
    };
    load();
    const unsubscribe = window.codevo.on('stats-changed', load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return text;
}
