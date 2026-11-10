import { useEffect } from 'react';
import { sectionPage } from '../../shared/section-focus';
import type { NavTarget } from '../navigation';

export function useSectionFocusRequests(navigate: (target: NavTarget) => void): void {
  useEffect(() => {
    const take = (): void => {
      window.codevo.takeSectionFocus().then(
        (section) => {
          if (section === null) {
            return;
          }
          navigate({ page: sectionPage(section), section });
        },
        (error: unknown) => console.error('Reading the requested section failed', error),
      );
    };
    take();
    return window.codevo.on('section-focus-requested', take);
  }, [navigate]);
}
