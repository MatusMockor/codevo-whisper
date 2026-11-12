import { useEffect } from 'react';
import { focusTarget } from '../focus-target';
import type { NavTarget } from '../navigation';

export function useSectionFocusRequests(navigate: (target: NavTarget) => void): void {
  useEffect(() => {
    const take = (): void => {
      window.codevo.takeSectionFocus().then(
        (request) => {
          if (request === null) {
            return;
          }
          navigate(focusTarget(request));
        },
        (error: unknown) => console.error('Reading the requested section failed', error),
      );
    };
    take();
    return window.codevo.on('section-focus-requested', take);
  }, [navigate]);
}
