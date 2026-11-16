import { useEffect } from 'react';

export const CATALOG_POLL_MS = 1500;

function refresh(): Promise<void> {
  if (document.visibilityState !== 'visible') {
    return Promise.resolve();
  }
  return window.codevo.refreshServerModels().catch((error: unknown) => {
    console.error('Refreshing the server models failed', error);
  });
}

export function useCatalogPolling(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (): void => {
      timer = setTimeout(() => {
        void refresh().then(() => {
          if (stopped) {
            return;
          }
          schedule();
        });
      }, CATALOG_POLL_MS);
    };
    schedule();
    return () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [active]);
}
