"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { DeviceActor } from "@/lib/offline/owner";

/**
 * Who is using the app, for everything that reads or writes the device's own
 * store: the flush, the pending strip, the draft row, the entry form.
 *
 * Inside a group it is provided by `OfflineEntryProvider`, from the actor the
 * group layout has already resolved in order to authorize the page — so the
 * queue learns whose entries it may send without a request of its own, and
 * without one per flush. The offline screen provides it from a group's
 * snapshot instead, since nothing there was rendered by a server (see
 * `OfflineGroups`).
 *
 * Null outside both. Everything that reads it treats null as "nobody": no
 * entry is sent, no draft is offered, and anything queued is held rather than
 * stamped with a guess.
 */
const DeviceActorContext = createContext<DeviceActor | null>(null);

export function DeviceActorProvider({
  userId,
  groupId,
  participantId,
  children,
}: DeviceActor & { children: ReactNode }) {
  // One object per actor rather than per render, so the flush's subscription
  // is not torn down and re-attached by every refresh of the layout above.
  const actor = useMemo(
    () => ({ userId, groupId, participantId }),
    [userId, groupId, participantId],
  );
  return (
    <DeviceActorContext.Provider value={actor}>
      {children}
    </DeviceActorContext.Provider>
  );
}

export function useDeviceActor(): DeviceActor | null {
  return useContext(DeviceActorContext);
}
