"use client";

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { NavigationGroup } from "@/modules/balances/navigation";

/*
 * The last list of groups the sidebar drew, kept for the length of the page.
 *
 * Home and a group are two layouts, so moving between them mounts a new
 * sidebar whose list is still on its way. Rather than blank the column for
 * that moment, the waiting sidebar draws what the last one had — the same
 * groups, at most a navigation old — and the fresh list replaces it as soon
 * as it lands. The ⌘K palette, the phone's group switcher and the sidebar's
 * "Add to which group?" read it too.
 *
 * It is kept with the account it was read for, and only ever handed back to
 * that account. The page outlives a session: signing out ends in a
 * `redirect`, signing in in a `router.push`, and neither reloads anything —
 * so a list kept on its own was drawn, groups and balances, under the next
 * person to sign in on the same browser, until their own arrived. Signing out
 * also forgets it outright (`leaveDevice`); the owner check is what holds when
 * a session ends some other way — it expires, or is revoked from another
 * device — and somebody else signs in over what was left.
 *
 * Written only from an effect, so a render never mutates it.
 */
let known: {
  readonly owner: string;
  readonly groups: readonly NavigationGroup[];
} | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Who the screen is being drawn for: the signed-in account's user id, or null
 * for a guest, who has no list of groups to keep. Without one — a screen that
 * did not say — nothing is kept and nothing is handed back.
 */
const OwnerContext = createContext<string | null>(null);

/**
 * Says whose groups may be kept and drawn below it. Mounted by the layouts
 * that draw the app's shell, which have already resolved the account to
 * authorize the page, so it costs no request of its own.
 */
export function KnownGroupsOwner({
  userId,
  children,
}: {
  userId: string | null;
  children: ReactNode;
}) {
  return <OwnerContext value={userId}>{children}</OwnerContext>;
}

/** The account the screen below is drawn for, if it is an account's. */
export function useKnownGroupsOwner(): string | null {
  return useContext(OwnerContext);
}

/**
 * The groups the sidebar last received for the account on screen, or null
 * before any have — and null, too, when the list on hand was read for
 * somebody else.
 */
export function useKnownGroups(): readonly NavigationGroup[] | null {
  const owner = useContext(OwnerContext);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => known,
    () => null,
  );
  if (owner === null || snapshot === null || snapshot.owner !== owner) {
    return null;
  }
  return snapshot.groups;
}

/** Keeps `groups` as the last list drawn for `owner`. */
export function rememberGroups(
  owner: string,
  groups: readonly NavigationGroup[],
) {
  if (known?.owner === owner && known.groups === groups) return;
  known = { owner, groups };
  notify();
}

/** Drops the list, whoever it was for. Signing out calls this. */
export function forgetKnownGroups() {
  if (known === null) return;
  known = null;
  notify();
}
