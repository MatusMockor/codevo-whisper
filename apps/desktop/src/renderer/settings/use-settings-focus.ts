import { useEffect } from 'react';
import type { NavTarget } from '../navigation';

export function useSettingsFocusRequests(navigate: (target: NavTarget) => void): void {
  useEffect(() => {
    const take = (): void => {
      window.codevo.takeSettingsFocus().then(
        (section) => {
          if (section === null) {
            return;
          }
          navigate({ page: 'settings', section });
        },
        (error: unknown) => console.error('Reading the requested settings section failed', error),
      );
    };
    take();
    return window.codevo.on('settings-focus-requested', take);
  }, [navigate]);
}
