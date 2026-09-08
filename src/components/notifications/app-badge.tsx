"use client";

import { useEffect } from "react";

/**
 * The unread count, on the installed app's own icon.
 *
 * The same number the bell draws in the header, put where it can be read
 * without opening anything — which is the only place a count is worth having
 * when the app is shut. It is the calm half of the notification story: a push
 * interrupts, a badge waits.
 *
 * Mounted beside the bell rather than in the root layout, so there is exactly
 * one writer. Two components setting the badge from two different counts is
 * how it ends up stuck on a number nothing on screen agrees with.
 *
 * ## Why nothing here asks for permission
 *
 * The Badging API has no prompt of its own. It is granted by the platform to
 * an app that is *installed* — and on iOS, additionally, to one that has been
 * allowed to notify. Both are decisions the reader has already made or not
 * made elsewhere, and neither is worth a dialog here: a browser tab simply
 * throws, which is the same outcome as not calling it at all.
 *
 * So every call is guarded twice. `in navigator` keeps it off Firefox, which
 * ships neither method, and the rejection handler swallows the
 * `NotAllowedError` an uninstalled iOS web app answers with. A badge that
 * cannot be set is not a failure worth telling anybody about.
 */
export function AppBadge({ count }: { count: number }) {
  useEffect(() => {
    if (!("setAppBadge" in navigator) || !("clearAppBadge" in navigator)) {
      return;
    }

    /*
     * Zero is cleared rather than set. `setAppBadge(0)` is specified to clear
     * it too, but the platforms disagree in practice — some draw a dot for it,
     * which is precisely the thing an emptied inbox should not leave behind.
     */
    const written =
      count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();

    // Never `await`ed anywhere and never surfaced: see the note above.
    written.catch(() => {});
  }, [count]);

  return null;
}
