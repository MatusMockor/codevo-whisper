import { useState, type KeyboardEvent } from 'react';
import { activeRovingIndex, rovingIndex, type RovingSteps } from './roving-index';

export type RovingItem = { tabIndex: number; onFocus: () => void; 'data-roving': string };

export type RovingFocus = { onKeyDown: (event: KeyboardEvent<HTMLElement>) => void; item: (index: number) => RovingItem };

export function useRovingFocus(keys: readonly string[], steps: RovingSteps): RovingFocus {
  const [focused, setFocused] = useState<string | null>(null);
  const active = activeRovingIndex(keys, focused);

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const next = rovingIndex(event.key, active, keys.length - 1, steps);
    const key = next === null ? undefined : keys[next];
    if (key === undefined) {
      return;
    }
    event.preventDefault();
    setFocused(key);
    event.currentTarget.querySelector<HTMLElement>(`[data-roving="${key}"]`)?.focus();
  }

  return {
    onKeyDown,
    item: (index) => {
      const key = keys[index] ?? '';
      return { tabIndex: index === active ? 0 : -1, onFocus: () => setFocused(key), 'data-roving': key };
    },
  };
}
