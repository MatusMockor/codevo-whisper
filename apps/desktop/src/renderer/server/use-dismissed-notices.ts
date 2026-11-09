import { useState } from 'react';

const dismissedNotices = new Set<string>();

export function useDismissedNotices(): { dismissed: ReadonlySet<string>; dismiss: (deviceId: string) => void } {
  const [, setRevision] = useState(0);
  return {
    dismissed: dismissedNotices,
    dismiss: (deviceId) => {
      dismissedNotices.add(deviceId);
      setRevision((revision) => revision + 1);
    },
  };
}
