import { useEffect, useState, type RefObject } from 'react';
import { pickActiveGroup, type GroupPosition } from './active-group';
import type { SettingsGroupId } from './settings-catalog';

const SPY_LINE = 96;

const END_SLACK = 2;

function groupPositions(root: HTMLElement): GroupPosition<SettingsGroupId>[] {
  return [...root.querySelectorAll<HTMLElement>('.set-group[data-section]')]
    .filter((element) => !element.hidden)
    .map((element) => ({ id: element.dataset.section as SettingsGroupId, top: element.getBoundingClientRect().top }));
}

export function useActiveGroup(root: RefObject<HTMLElement | null>, revision: string): SettingsGroupId | null {
  const [active, setActive] = useState<SettingsGroupId | null>(null);
  useEffect(() => {
    const element = root.current;
    const scroller = element?.closest<HTMLElement>('.panel');
    if (element === null || element === undefined || scroller === null || scroller === undefined) {
      return;
    }
    const update = (): void => {
      const atEnd = scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - END_SLACK;
      setActive(pickActiveGroup(groupPositions(element), scroller.getBoundingClientRect().top + SPY_LINE, atEnd));
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, [root, revision]);
  return active;
}
