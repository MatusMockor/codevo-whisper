import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { NavTarget } from '../navigation';

type HeadingFocus = { heading: RefObject<HTMLHeadingElement | null>; openWithHeading: (next: NavTarget) => void };

export function useHeadingFocus(target: NavTarget, setTarget: (next: NavTarget) => void): HeadingFocus {
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef<NavTarget | null>(null);

  useEffect(() => {
    if (pending.current !== target) {
      return;
    }
    pending.current = null;
    heading.current?.focus();
  }, [target]);

  const openWithHeading = useCallback(
    (next: NavTarget) => {
      const copy = { ...next };
      pending.current = copy;
      setTarget(copy);
    },
    [setTarget],
  );

  return { heading, openWithHeading };
}
