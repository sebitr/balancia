"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAutosave, type Autosave } from "@/components/ui/use-autosave";
import { updateDestinationAction } from "@/modules/backup/actions";
import type { DestinationView } from "@/modules/backup/service";

/**
 * Everything on the overview that is written the moment it is touched.
 *
 * The pause switch beside the card's facts and every control inside Manage —
 * Daily/Weekly, how many to keep, the group ticks, receipts — are one draft
 * with one writer, rather than five. That is what makes them safe to press in
 * a hurry: `useAutosave` queues the writes behind one another and sends the
 * newest draft after whatever is in the air, so a second tap cannot land an
 * older value on top of a newer one.
 *
 * ## Silence, and what is not silent
 *
 * Nothing here announces itself. The control moved and stayed moved, and it is
 * still under the finger to be moved back, which is the whole of the
 * confirmation (see "A control that flicks back says it for itself" in
 * `AGENTS.md`). A *refusal* is the one thing a control cannot carry, so it is
 * the only thing spoken: the draft is put back to what the server holds — the
 * control flicks back to it — and an error toast says why nothing moved.
 */

export interface Draft {
  readonly paused: boolean;
  readonly frequency: "daily" | "weekly";
  readonly keepLast: number;
  /** The groups left out. A group is ticked when it is not in here. */
  readonly excludedGroupIds: readonly string[];
  readonly includeReceipts: boolean;
}

export function draftOf(destination: DestinationView): Draft {
  return {
    paused: destination.status === "paused",
    frequency: destination.frequency,
    keepLast: destination.keepLast,
    excludedGroupIds: destination.excludedGroupIds,
    includeReceipts: destination.includeReceipts,
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function same(a: Draft, b: Draft): boolean {
  return (
    a.paused === b.paused &&
    a.frequency === b.frequency &&
    a.keepLast === b.keepLast &&
    a.includeReceipts === b.includeReceipts &&
    sameSet(a.excludedGroupIds, b.excludedGroupIds)
  );
}

/** Only what changed, so a write never repeats a choice made elsewhere. */
function patchBetween(before: Draft, next: Draft) {
  return {
    ...(next.paused !== before.paused && { paused: next.paused }),
    ...(next.frequency !== before.frequency && { frequency: next.frequency }),
    ...(next.keepLast !== before.keepLast && { keepLast: next.keepLast }),
    ...(next.includeReceipts !== before.includeReceipts && {
      includeReceipts: next.includeReceipts,
    }),
    ...(!sameSet(next.excludedGroupIds, before.excludedGroupIds) && {
      excludedGroupIds: [...next.excludedGroupIds],
    }),
  };
}

export function useDestinationDraft(
  destination: DestinationView,
): Autosave<Draft> {
  const t = useTranslations("cloudBackup");
  const initial = draftOf(destination);

  // What the server is known to hold. `useAutosave` keeps its own copy for
  // deciding whether anything is left to send; this one is what a refusal puts
  // the controls back to.
  const stored = useRef<Draft>(initial);
  const self = useRef<Autosave<Draft> | null>(null);

  const autosave: Autosave<Draft> = useAutosave<Draft>({
    initial,
    same,
    write: async (next) => {
      // Either kind of refusal reads the same to the person: the server did
      // not keep it. A fault comes back as `ok: false`, a refusal the screen
      // could have worded as `data.ok === false`, and a request that never
      // arrived throws. None of them may leave a control showing a value the
      // account does not hold.
      let kept = false;
      try {
        const result = await updateDestinationAction(
          destination.id,
          patchBetween(stored.current, next),
        );
        kept = result.ok && !(result.data && !result.data.ok);
      } catch {
        kept = false;
      }
      if (!kept) {
        self.current?.edit(stored.current, "held");
        toast.error(t("overview.refused"));
        return false;
      }
      stored.current = next;
      return true;
    },
    // No toast, no Undo: pressing the control again is the way back.
    announce: () => {},
  });
  useEffect(() => {
    self.current = autosave;
  });

  return autosave;
}
