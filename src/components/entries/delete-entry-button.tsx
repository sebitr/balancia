"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  deleteExpenseAction,
  deleteSettlementAction,
  restoreExpenseAction,
  restoreSettlementAction,
} from "@/modules/expenses/actions";
import { toastUndoable } from "@/components/ui/sonner";
import { ACTION, ACTION_DESTRUCTIVE } from "./detail-blocks";
import { cn } from "@/lib/utils";

/**
 * Removing the entry the detail screen is showing.
 *
 * Destructive, so it always asks first and names what it will remove. The
 * dialog says it in words because the button itself cannot: a 46px square with
 * a bin in it is the handoff's shape, and the only place the entry's own
 * description can be read out is the confirmation.
 *
 * Both tables land here rather than in two near-identical buttons — what
 * differs between removing an expense and removing a repayment is one action
 * import, and the sentence the reader is shown is the same either way.
 *
 * The confirmation is not the last word. Deletion is soft, so the toast that
 * follows carries an Undo for as long as it is on screen. The dialog still
 * asks first — recalculating a group's balances without an entry is a change
 * worth agreeing to — but it no longer calls that change irreversible.
 */
export function DeleteEntryButton({
  groupId,
  kind,
  id,
  description,
  backTo,
}: {
  groupId: string;
  kind: "expense" | "settlement";
  id: string;
  /** What the confirmation names, so nobody deletes the wrong one. */
  description: string;
  /**
   * The list to land on, filters and all.
   *
   * The detail screen builds it, because the detail screen is the one that
   * knows which list the reader came from. Deleting is still leaving a row
   * behind, and there is no reason for it to also throw away the search that
   * found it.
   */
  backTo: string;
}) {
  const router = useRouter();
  const t = useTranslations("transactionDetail.delete");
  const tCommon = useTranslations("common");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  /**
   * Puts the entry back, which by now means putting it back behind the reader:
   * they are on the list, and may have gone further still. A refresh brings
   * the entry back into whatever they are looking at instead of hauling them
   * onto the screen it reappeared on.
   */
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

  const onConfirm = async () => {
    setPending(true);
    try {
      const result =
        kind === "settlement"
          ? await deleteSettlementAction(groupId, id)
          : await deleteExpenseAction(groupId, id);
      if (!result.ok) {
        // The dialog stays open on a refusal, so it can be tried again.
        toast.error(result.error ?? t("failed"));
        return;
      }
      /*
       * Close before anything else. A modal dialog holds the page down with
       * `pointer-events: none` on the body, and the toaster is a child of the
       * body like everything else — so a toast raised while this is still open
       * is one nobody can press. Leaving the navigation to unmount the dialog
       * was not enough: the Undo was on screen and inert for as long as that
       * took, which is exactly the moment it is reached for.
       */
      setConfirmOpen(false);
      toastUndoable(t("deleted"), {
        label: tCommon("undo"),
        onUndo: onRestore,
      });
      // The screen it was on no longer has anything to show, so leave rather
      // than refresh in place, which would render a 404. Nothing is refreshed
      // afterwards either: the delete revalidated the list server-side, so the
      // push already lands on a list without this entry, and a second
      // navigation in the same tick only races the first.
      router.push(backTo);
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={t("trigger")}
          className={cn(ACTION, ACTION_DESTRUCTIVE, "disabled:opacity-50")}
        >
          {pending ? (
            <Loader2 aria-hidden="true" className="size-[17px] animate-spin" />
          ) : (
            <Trash2 aria-hidden="true" className="size-[17px]" />
          )}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("body", { entry: description })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("keep")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
            disabled={pending}
          >
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
