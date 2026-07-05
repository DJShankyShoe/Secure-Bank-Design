import React, { useEffect, useRef, useState } from 'react';
import { setActivityHandler } from '../api/api';

// Mirrors the server's 15-minute idle timeout (SR-13). The server resets it on
// every request, so we reset our countdown off the same signal (api activity).
const IDLE_MS = 15 * 60 * 1000;

export default function SessionTimer({ onExpire }) {
  const deadlineRef = useRef(Date.now() + IDLE_MS);
  const [remaining, setRemaining] = useState(IDLE_MS);

  useEffect(() => {
    // Each successful API call extends the session server-side → reset the clock.
    setActivityHandler(() => {
      deadlineRef.current = Date.now() + IDLE_MS;
    });

    const id = setInterval(() => {
      const left = deadlineRef.current - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        clearInterval(id);
        if (onExpire) onExpire();
      }
    }, 1000);

    return () => {
      clearInterval(id);
      setActivityHandler(null);
    };
  }, [onExpire]);

  const mm = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');

  return <span>Session expires in {mm}:{ss}</span>;
}
