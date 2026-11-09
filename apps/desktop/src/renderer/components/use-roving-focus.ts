import { useState, type KeyboardEvent } from 'react';
import { rovingIndex, type RovingSteps } from './roving-index';

export type RovingItem = { tabIndex: number; onFocus: () => void; 'data-roving': number };

export type RovingFocus = { onKeyDown: (event: KeyboardEvent<HTMLElement>) => void; item: (index: number) => RovingItem };

export function useRovingFocus(count: number, steps: RovingSteps): RovingFocus {
  const last = count - 1;
  const [focused, setFocused] = useState<number | null>(null);
  const active = Math.min(focused ?? last, last);

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const next = rovingIndex(event.key, active, last, steps);
    if (next === null) {
      return;
    }
    event.preventDefault();
    setFocused(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-roving="${next}"]`)?.focus();
  }

  return {
    onKeyDown,
    item: (index) => ({ tabIndex: index === active ? 0 : -1, onFocus: () => setFocused(index), 'data-roving': index }),
  };
}
