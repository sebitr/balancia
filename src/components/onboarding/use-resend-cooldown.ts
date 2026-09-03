"use client";

import { useEffect, useState } from "react";

/** How long "Send another code" waits after a code has gone out, in seconds. */
export const RESEND_COOLDOWN_SECONDS = 30;

/**
 * The seconds left before another code may be asked for.
 *
 * A second tap on "Send another code" while the first mail is still in flight
 * is the commonest way to end up with a code that no longer works: issuing a
 * new one retires the old one, and the mail that arrives first is the one
 * that has just been invalidated. It also spends the address's daily budget
 * of sign-up mails, which is three. So the button counts down instead, from
 * the moment a code is sent, and the count is the label.
 *
 * `start` is called whenever a code goes out; `remaining` is zero whenever a
 * new one may be asked for.
 */
export function useResendCooldown(seconds = RESEND_COOLDOWN_SECONDS): {
  remaining: number;
  start: () => void;
} {
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The clock only ticks while there is a deadline to measure against; the
  // interval is the external system, and its callback is where the state
  // moves.
  useEffect(() => {
    if (until === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);

  const remaining =
    until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));

  return {
    remaining,
    start: () => {
      const startedAt = Date.now();
      setNow(startedAt);
      setUntil(startedAt + seconds * 1000);
    },
  };
}
