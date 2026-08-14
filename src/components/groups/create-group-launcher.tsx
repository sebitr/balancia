"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CreateGroupSheet } from "@/components/groups/create-group-sheet";

/**
 * Opens the create-group sheet over whatever it is mounted on.
 *
 * The sheet is addressable — `?new` opens it — so the PWA shortcut, the old
 * `/groups/new` bookmark and the buttons on this page all arrive the same way,
 * and none of them has to become a screen of its own.
 *
 * Closing rewrites the URL through the History API rather than the router:
 * the page underneath has not changed, and re-running a dashboard's worth of
 * queries to drop a search parameter would be a visible pause for nothing.
 */
export function CreateGroupLauncher({
  defaultName,
  defaultTimezone,
  defaultCurrency,
}: {
  defaultName: string;
  defaultTimezone: string;
  defaultCurrency: string;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const requested = params.has("new");
  const [open, setOpen] = useState(requested);

  /*
   * A second arrival at `?new` — the button pressed again after a dismissal —
   * has to reopen it. Adjusted while rendering rather than in an effect: the
   * sheet is not an external system to synchronise with, and this way it is
   * open in the same commit that saw the parameter, with no flash of a closed
   * sheet in between.
   */
  const [seen, setSeen] = useState(requested);
  if (requested !== seen) {
    setSeen(requested);
    if (requested) setOpen(true);
  }

  const openChanged = (next: boolean) => {
    setOpen(next);
    if (next || !requested) return;
    // Only `new` is ours to remove — anything else on the URL belongs to the
    // page underneath.
    const rest = new URLSearchParams(params);
    rest.delete("new");
    const query = rest.toString();
    window.history.replaceState(
      null,
      "",
      query ? `${pathname}?${query}` : pathname,
    );
  };

  return (
    <CreateGroupSheet
      open={open}
      onOpenChange={openChanged}
      defaultName={defaultName}
      defaultTimezone={defaultTimezone}
      defaultCurrency={defaultCurrency}
    />
  );
}
