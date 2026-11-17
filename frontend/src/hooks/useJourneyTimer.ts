import { useEffect, useState } from 'react';
import { normalizeUtcTimestamp } from '../utils/time';

export function useJourneyTimer(startedAt: string | null | undefined, isRunning: boolean = true) {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    if (!startedAt || !isRunning) return;

    const normalizedTime = normalizeUtcTimestamp(startedAt);
    if (!normalizedTime) return;

    const startMs = new Date(normalizedTime).getTime();
    if (isNaN(startMs)) return;

    const update = () => {
      const now = Date.now();
      // Clamp so elapsed seconds never go negative due to clock drift
      const diff = Math.max(0, Math.floor((now - startMs) / 1000));
      setElapsedSeconds(diff);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt, isRunning]);

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  const formattedTime = [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0'),
  ].join(':');

  return { elapsedSeconds, formattedTime };
}
