"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  restoreExpenseAction,
  restoreSettlementAction,
} from "@/modules/expenses/actions";
import { restoreParticipantAction } from "@/modules/groups/actions";
import { restoreRecurringAction } from "@/modules/recurring/actions";

/**
 * Putting a deleted entry back from the line in the history that deleted it —
 * or a removed person, from the line that removed them.
 *
 * The same restore the Undo toast calls, reached without the toast. That one
 * is on screen for eight seconds and does not wait while it holds keyboard
 * focus, which is too short for a screen reader, a switch or a keyboard to get
 * to its button — and too short for anybody who looked away. This one waits
 * for as long as the entry stays deleted.
 *
 * It says nothing when it works, for the reason the settings screens do not:
 * the row it was pressed on changes to say so, under the finger that pressed
 * it. That word takes the focus the button had, so a keyboard or a screen
 * reader is left where it was and hears what happened, rather than being
 * dropped back at the top of the page with the button gone. A refusal does
 * get a toast, because nothing on the row can say why.
 *
 * `deleted` comes from the server on every render, and the refresh that
 * follows a restore turns it false. The word stays anyway: the component is
 * mounted on every deletion row, not only the live ones, precisely so that the
 * refresh does not unmount the thing holding focus.
 */

/**
 * One restore per kind, keyed by the `entity_type` the deletion recorded.
 *
 * Spelled out here rather than imported from the activity service, which is
 * server-only; the feed hands over a `RestorableKind` from there, so a kind
 * added on that side and not on this one fails to compile at the call site.
 */
const RESTORE = {
  expense: restoreExpenseAction,
  settlement: restoreSettlementAction,
  recurring_expense: restoreRecurringAction,
  participant: restoreParticipantAction,
} satisfies Record<
  string,
  (groupId: string, id: string) => Promise<{ ok: boolean; error?: string }>
>;

export function RestoreDeleted({
  groupId,
  kind,
  entityId,
  label,
  deleted,
}: {
  groupId: string;
  kind: keyof typeof RESTORE;
  entityId: string;
  /** The button's accessible name: its own word, then what it puts back. */
  label: string;
  /** The server's answer: still deleted, and this is its latest deletion. */
  deleted: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("activity.restore");
  const [state, setState] = useState<"idle" | "pending" | "restored">("idle");
  const done = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (state === "restored") done.current?.focus();
  }, [state]);

  if (state === "restored") {
    return (
      <span
        ref={done}
        tabIndex={-1}
        className="shrink-0 self-center text-xs text-muted-foreground outline-none"
      >
        {t("done")}
      </span>
    );
  }
  if (!deleted) return null;

  const onRestore = async () => {
    if (state === "pending") return;
    setState("pending");
    const result = await RESTORE[kind](groupId, entityId);
    if (!result.ok) {
      setState("idle");
      toast.error(result.error ?? t("failed"));
      // Somebody else may have put it back first, which is also a refusal:
      // the refresh lets the row show what the group actually has.
      router.refresh();
      return;
    }
    setState("restored");
    router.refresh();
  };

  const pending = state === "pending";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      // Not `disabled`: a disabled button drops the focus it holds, and the
      // point of this one is that a keyboard can keep hold of it.
      aria-disabled={pending || undefined}
      onClick={() => void onRestore()}
      className="shrink-0 self-center aria-disabled:opacity-50"
    >
      {pending ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : (
        <RotateCcw aria-hidden="true" />
      )}
      {t("action")}
    </Button>
  );
}
