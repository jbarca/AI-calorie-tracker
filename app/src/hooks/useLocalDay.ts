import { localDayKey } from '@calorie/shared';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** The current local day ('YYYY-MM-DD'); updates at midnight and when the app is foregrounded. */
export function useLocalDayKey(): string {
  const [day, setDay] = useState(() => localDayKey(new Date()));

  useEffect(() => {
    const refresh = () => setDay(localDayKey(new Date()));
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(refresh, nextMidnight.getTime() - now.getTime() + 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [day]);

  return day;
}
