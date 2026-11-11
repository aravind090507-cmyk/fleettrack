import React, { useState, useEffect, useCallback } from 'react';
import { render } from '@testing-library/react';
import { it, expect } from 'vitest';
import { useGeolocation } from '../hooks/useGeolocation';
import { useWebSocket } from '../hooks/useWebSocket';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

it('PublicTrackingPage pattern: inline callbacks + 1s ticking state maintains stable WebSocket (NO churn)', async () => {
  let created = 0;
  let closed = 0;

  class FakeWS {
    static OPEN = 1;
    readyState = 1;
    onopen: any;
    onclose: any;
    onmessage: any;
    onerror: any;
    constructor(public url: string) {
      created++;
      setTimeout(() => this.onopen && this.onopen(), 0);
    }
    send() {}
    close() {
      closed++;
      this.readyState = 3;
    }
  }

  (globalThis as any).WebSocket = FakeWS;

  function Page() {
    const [secs, setSecs] = useState(0);
    const [ended, setEnded] = useState(false);

    useEffect(() => {
      const t = setInterval(() => setSecs((s) => s + 1), 1000);
      return () => clearInterval(t);
    }, []);

    const onMessage = useCallback(() => {}, []);
    // Inline callback onJourneyCompleted every render, with ticking state
    useWebSocket({
      url: 'ws://x/ws/track/T',
      onMessage,
      onJourneyCompleted: () => setEnded(true),
    });

    return <div>{secs}{String(ended)}</div>;
  }

  const { unmount } = render(<Page />);
  await sleep(5200);

  console.log(`[PUBLIC WS] in 5.2s: sockets created=${created}, closed=${closed}`);

  // Acceptance: exactly 1 socket opened in 5.2s despite 5+ component re-renders
  expect(created).toBe(1);
  expect(closed).toBe(0);

  unmount();
  expect(closed).toBe(1);
});

it('ActiveJourney pattern: literal coord objects + onLocationUpdate => stable subscription (NO ping storm)', async () => {
  let getCur = 0;
  let watch = 0;
  let clear = 0;
  let uploads = 0;

  const fix = () => ({
    coords: {
      latitude: 12.97,
      longitude: 77.59,
      accuracy: 10,
      speed: null,
      heading: null,
      altitude: null,
    },
    timestamp: Date.now(),
  });

  (globalThis as any).navigator.geolocation = {
    getCurrentPosition: (ok: any) => {
      getCur++;
      setTimeout(() => ok(fix()), 20);
    },
    watchPosition: (ok: any) => {
      watch++;
      return watch;
    },
    clearWatch: () => {
      clear++;
    },
  };

  function Driver() {
    const [pings, setPings] = useState(0);
    const cb = useCallback(async (_p: any) => {
      uploads++;
      setPings((c) => c + 1);
    }, []);

    const { startWatching, stopWatching } = useGeolocation({
      onLocationUpdate: cb,
    });

    useEffect(() => {
      startWatching();
      return () => stopWatching();
    }, [startWatching, stopWatching]);

    return <div>{pings}</div>;
  }

  const { unmount } = render(<Driver />);
  await sleep(2000);

  console.log(
    `[DRIVER GPS] in 2s with ONE real fix source: uploads=${uploads}, getCurrentPosition calls=${getCur}, watchPosition calls=${watch}, clearWatch=${clear}`
  );

  // Acceptance: uploads <= number of distinct fixes (exactly 1 from initial getCurrentPosition, NO runaway loop)
  expect(uploads).toBeLessThanOrEqual(2);
  expect(watch).toBe(1);
  expect(clear).toBe(0);

  unmount();
  expect(clear).toBe(1);
});
