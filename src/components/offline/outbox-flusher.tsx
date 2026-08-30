"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { flushOutbox } from "@/lib/offline/flush";

/**
 * Sends what is waiting, whenever there is a reason to think it might work.
 *
 * Three triggers, and they are three rather than one because none of them is
 * reliable on a phone:
 *
 *  - Mounting. Covers the app being opened after the queue was filled, which
 *    is the ordinary case: entries typed at dinner, sent when the app is
 *    reopened at the hotel.
 *  - `online`. The browser noticing a network. Fires eagerly and sometimes
 *    wrongly — a failed flush costs one request and leaves the queue intact.
 *  - Becoming visible again. The one that actually catches most reconnections,
 *    because a backgrounded tab on iOS is frozen and gets no `online` event at
 *    all; it simply wakes up somewhere with signal.
 *
 * Deliberately *not* the Background Sync API, which would be the textbook
 * answer and is unavailable in Safari — that is, on the iPhones this feature
 * exists for. A queue that drained on Android and quietly did not on iOS would
 * be worse than no queue.
 */
export function OutboxFlusher() {
  const router = useRouter();
  const t = useTranslations("outbox");
  /*
   * What to do about a successful flush, kept in a ref that is refreshed after
   * every render.
   *
   * The subscription below has to outlive re-renders — it is the app's only
   * connection to the queue, and re-attaching it on every change of a
   * translation object would mean a drain on every one of those too. But it
   * still needs today's `t` and `router` when it fires. A ref is the seam
   * between the two: the listener reads it, and this keeps it current.
   */
  const announce = useRef<(written: number) => void>(undefined);

  useEffect(() => {
    announce.current = (written: number) => {
      if (written === 0) return;
      toast.success(t("synced", { count: written }));
      // The balances on screen were computed without these entries. Refreshing
      // is the difference between the queue emptying and the group agreeing
      // that it did.
      router.refresh();
    };
  });

  useEffect(() => {
    let live = true;

    const drain = () => {
      void flushOutbox().then((summary) => {
        if (live) announce.current?.(summary.written);
      });
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") drain();
    };

    drain();
    window.addEventListener("online", drain);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      window.removeEventListener("online", drain);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
