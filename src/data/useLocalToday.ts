import { useEffect, useState } from 'react';
import { toDateKey } from '../domain/dates';

export function useLocalToday(): string {
  const [today, setToday] = useState(() => toDateKey(new Date()));
  useEffect(() => {
    const update = () => setToday(toDateKey(new Date()));
    const timer = window.setInterval(update, 30000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  return today;
}
