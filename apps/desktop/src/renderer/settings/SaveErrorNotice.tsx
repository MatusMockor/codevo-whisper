import { useEffect, useState } from 'react';
import { SAVE_FAILED_EVENT } from './use-settings';

const VISIBLE_MS = 5000;

export function SaveErrorNotice() {
  const [failures, setFailures] = useState(0);

  useEffect(() => {
    const show = (): void => setFailures((count) => count + 1);
    window.addEventListener(SAVE_FAILED_EVENT, show);
    return () => window.removeEventListener(SAVE_FAILED_EVENT, show);
  }, []);

  useEffect(() => {
    if (failures === 0) {
      return;
    }
    const timer = setTimeout(() => setFailures(0), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [failures]);

  if (failures === 0) {
    return null;
  }
  return (
    <p className="save-error" role="alert">
      Zmenu sa nepodarilo uložiť. Skúste to znova.
    </p>
  );
}
