import { useEffect, useState } from 'react';
import { localDate } from '../../shared/calendar-date';
import { watchToday } from './today-watch';

function onWindowWake(listener: () => void): () => void {
  window.addEventListener('focus', listener);
  document.addEventListener('visibilitychange', listener);
  return () => {
    window.removeEventListener('focus', listener);
    document.removeEventListener('visibilitychange', listener);
  };
}

export function useToday(): string {
  const [today, setToday] = useState(() => localDate(new Date()));

  useEffect(() => watchToday(setToday, { onWake: onWindowWake }), []);

  return today;
}
