import { useEffect, useState } from 'react';

export function useDataFolder(): string | null {
  const [folder, setFolder] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.codevo.getDataFolder().then(
      (value) => {
        if (active) {
          setFolder(value);
        }
      },
      (error: unknown) => {
        console.error('Reading the data folder failed', error);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return folder;
}
