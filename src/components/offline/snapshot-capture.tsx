"use client";

import { useEffect } from "react";
import { saveSnapshot, type GroupSnapshot } from "@/lib/offline/snapshot";

/**
 * Writes the entry form's own inputs to the device, every time that form opens
 * with a server behind it.
 *
 * Mounted by `EntryScreen` and nowhere else, which is the point: the snapshot
 * is not a second description of a group assembled for offline use — it is
 * literally the props the online form was just handed. There is no shape here
 * that can drift from what the form reads, because it is the same shape.
 *
 * The cost of that placement is the one thing worth knowing about this
 * feature: a group can only be added to offline once its add-entry screen has
 * been opened on this device at least once with a network. The alternative was
 * loading the roster in the group layout — a query on every navigation within
 * every group, paid by everybody, to serve the visit where somebody opens a
 * group for the first time in a place with no signal.
 */
export function SnapshotCapture(props: Omit<GroupSnapshot, "capturedAt">) {
  /*
   * The whole snapshot as one string, and the effect's only dependency.
   *
   * Two of these fields are arrays the server rebuilds on every render, so a
   * dependency list of the parts would fire on renders that changed nothing —
   * rewriting the snapshot, and its `capturedAt`, each time the drawer above
   * re-rendered. Comparing the content says what is actually meant: write this
   * again when the group has changed.
   */
  const serialized = JSON.stringify(props);

  useEffect(() => {
    // Failures are swallowed inside the store: a device that cannot keep a
    // snapshot still has a working online form, and saying so here would put a
    // message about IndexedDB in front of somebody adding an expense.
    void saveSnapshot(
      JSON.parse(serialized) as Omit<GroupSnapshot, "capturedAt">,
    );
  }, [serialized]);

  return null;
}
