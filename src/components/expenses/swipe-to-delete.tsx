"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  deleteExpenseAction,
  deleteSettlementAction,
  restoreExpenseAction,
  restoreSettlementAction,
} from "@/modules/expenses/actions";
import { toastUndoable } from "@/components/ui/sonner";
import { useSwipeAway } from "@/components/ui/use-swipe-away";
import { haptic } from "@/lib/haptics";

/**
 * Pushing a transaction off the list to delete it.
 *
 * The list is the longest screen in the app and the one people scroll looking
 * for the entry they typed the wrong amount into. Removing it took four taps
 * from here — open the row, find the bin, confirm, land back on the list — and
 * three of those exist only to get to the button.
 *
 * ## Why this does not ask first when the detail screen does
 *
 * `DeleteEntryButton` opens a confirmation, and its reasoning is sound for
 * where it sits: a 46px square with a bin in it, on a screen where the entry's
 * description is the only thing saying which entry you are about to lose. A
 * mis-tap there is one pixel away from the edit button beside it.
 *
 * A swipe is not that. It names its target — the row moving under the finger
 * *is* the entry — and it cannot be done by accident: the gesture has to
 * travel 104px horizontally after declaring itself horizontal, which is a
 * deliberate act in a way a tap never is. What is left to protect against is
 * changing one's mind, and the toast does that better than a dialog does,
 * because it survives the decision instead of preceding it.
 *
 * Deletion is soft either way — see the restore actions — so the Undo here is
 * the same Undo the detail screen offers, reached without the two screens.
 *
 * ## What the list does afterwards
 *
 * Nothing, deliberately. The server action revalidates the route, the refresh
 * brings down a new first page, and `usePages` throws away everything it had
 * paged in when the first page it was given changes identity. So the row goes
 * because the server says it is gone, not because this component hid it — and
 * an Undo puts it back the same way, with no local list to get out of step.
 */
export function SwipeToDelete({
  groupId,
  kind,
  id,
  /** Read out by the fallback button, so a keyboard names what it removes. */
  description,
  children,
}: {
  groupId: string;
  kind: "expense" | "settlement";
  id: string;
  description: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const t = useTranslations("transactionDetail.delete");
  const tCommon = useTranslations("common");
  const [pending, setPending] = useState(false);

  const onRestore = async () => {
    const result =
      kind === "settlement"
        ? await restoreSettlementAction(groupId, id)
        : await restoreExpenseAction(groupId, id);
    if (!result.ok) {
      toast.error(result.error ?? t("restoreFailed"));
      return;
    }
    router.refresh();
    toast.success(t("restored"));
  };

  const onDelete = async () => {
    // The gesture can finish twice — a second flick while the first request is
    // still out — and the second would delete an entry that is already gone.
    if (pending) return;
    setPending(true);
    try {
      const result =
        kind === "settlement"
          ? await deleteSettlementAction(groupId, id)
          : await deleteExpenseAction(groupId, id);
      if (!result.ok) {
        toast.error(result.error ?? t("failed"));
        // The row was animated off the side to say it had gone, and it has
        // not. Putting the list back the way the server still has it is the
        // only honest thing left to do.
        router.refresh();
        return;
      }
      haptic("commit");
      router.refresh();
      toastUndoable(t("deleted"), {
        label: tCommon("undo"),
        onUndo: onRestore,
      });
    } finally {
      setPending(false);
    }
  };

  const swipe = useSwipeAway(() => void onDelete());

  return (
    /*
     * The negative margins live here rather than on the row inside, so that
     * this box and the row's own painted area are the same box. Left on the
     * row, `overflow-hidden` would have cropped its hover fill six pixels in
     * from each side and drawn a seam down both edges of every row.
     */
    <div className="relative -mx-1.5 -my-[7px] overflow-hidden rounded-[10px]">
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-end bg-destructive/15 pr-4"
      >
        <span className="text-2xs font-semibold text-destructive-ink">
          {t("confirm")}
        </span>
      </span>

      {/* Opaque, so what shows through beside it is exactly how far the finger
          has travelled — and `flow-root`, so the row's own margins are
          contained rather than collapsing out through a parent with no
          padding, which would leave a band of the reveal above and below every
          row as if it were a border. */}
      <div ref={swipe} className="relative flow-root touch-pan-y bg-background">
        {children}
        {/* The same action without the gesture. Invisible until focused: a
            list of thirty rows does not need thirty visible Delete buttons,
            and a pointer has the detail screen. */}
        <button
          type="button"
          onClick={() => void onDelete()}
          disabled={pending}
          aria-label={t("body", { entry: description })}
          className="sr-only focus:not-sr-only focus:absolute focus:top-1 focus:right-0 focus:z-10 focus:rounded-md focus:bg-destructive/15 focus:px-2 focus:py-1 focus:text-2xs focus:font-semibold focus:text-destructive-ink focus:ring-2 focus:ring-ring focus:outline-none"
        >
          {t("confirm")}
        </button>
      </div>
    </div>
  );
}
