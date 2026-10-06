"use client";

import type { ReactNode } from "react";
import { useScreenPath } from "@/components/motion/screen";
import { GroupTabs } from "./group-nav";

/** The group's four places, as paths under the group: the tabs' own. */
const PLACES = ["", "/expenses", "/members", "/settings"] as const;

/**
 * The top of a group's screen on a desktop window: the group's tile and name,
 * what it holds, and its places as tabs.
 *
 * From `lg` up the sidebar has taken the header along the top, and with it the
 * group's name, which the phone's header carries; this is where the name
 * goes, and where the bottom bar's places go too. Below `lg` it is not drawn
 * at all — `display: none`, so the bar stays the one "Group sections" a
 * screen reader finds there.
 *
 * Only on the four places themselves. A screen reached by a push — an entry, a
 * person, Settle up, Statistics — opens on its own way back instead, the way
 * it does on a phone, so the reader is never shown tabs for a place they are
 * not on. Read from the screen being shown rather than the address: with the
 * entry drawer open over the transactions, the address is the drawer's, and
 * the transactions — and their header — are still what is underneath.
 *
 * It sits above the screen, outside the part that moves on a navigation, so a
 * switch between tabs fades the screen through and leaves the tabs where they
 * are. Its width follows the screen's: the readable column, or the overview's
 * wide one, whichever is below it.
 */
export function GroupHeader({
  groupId,
  children,
}: {
  groupId: string;
  /** The tile, the name and the meta line; see `group-header-facts.tsx`. */
  children: ReactNode;
}) {
  const shown = useScreenPath();
  const base = `/groups/${groupId}`;
  if (!PLACES.some((place) => shown === `${base}${place}`)) return null;

  return (
    <header
      data-slot="group-header"
      // `peer`, so the screen right after it can tell it is there and start
      // closer under it; see `Screen`.
      className="peer mx-auto hidden w-full max-w-3xl flex-col gap-5 px-6 pt-7 lg:flex lg:group-has-data-[layout=wide]/app-screen:max-w-(--app-content-max) xl:px-10"
    >
      {children}
      <GroupTabs groupId={groupId} />
    </header>
  );
}
