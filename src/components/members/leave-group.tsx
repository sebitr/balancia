"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, LogOut } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { leaveGroupAction } from "@/modules/groups/actions";

/**
 * What somebody still has open, already formatted: every currency they are
 * not square in, and which way the money runs. `mixed` is owing in one
 * currency and owed in another.
 */
export interface Outstanding {
  readonly amounts: string;
  readonly direction: "owes" | "owed" | "mixed";
}

/**
 * Leaving the group, at the foot of the reader's own row.
 *
 * Drawn as the removal at the foot of anybody else's row is, because it is
 * that removal — asked for by the person it removes. It is held back for the
 * same reason, and says so in the same place, in the reader's own words: an
 * open balance would be left on everybody's settle screen with nobody to
 * record it against. The owner is held back for good, since a group they own
 * would be left with nobody holding its door; what they can do instead is in
 * the group's settings.
 *
 * Confirmed in a dialog that opens on its safe choice. It promises no undo,
 * because there is none the reader could reach: the moment it lands they can
 * no longer open the group. The way back is somebody else's — an invitation,
 * or the owner's Restore in Activity — and the dialog says the first, which is
 * the one they can ask for.
 */
export function LeaveGroup({
  groupId,
  groupName,
  isOwner,
  archived,
  outstanding,
}: {
  groupId: string;
  groupName: string;
  isOwner: boolean;
  archived: boolean;
  outstanding: Outstanding | null;
}) {
  const router = useRouter();
  const t = useTranslations("membersPage");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const reasonId = useId();

  // In the order that decides it: an owner never leaves, nobody changes an
  // archived group, and only then is it the money.
  const reason = isOwner
    ? t("leaveBlockedOwner")
    : archived
      ? t("leaveBlockedArchived")
      : outstanding
        ? outstanding.direction === "owes"
          ? t("leaveBlockedOwes", { amounts: outstanding.amounts })
          : outstanding.direction === "owed"
            ? t("leaveBlockedOwed", { amounts: outstanding.amounts })
            : t("leaveBlockedMixed", { amounts: outstanding.amounts })
        : null;

  const onLeave = async () => {
    setPending(true);
    try {
      const result = await leaveGroupAction(groupId);
      // Closed either way: the toast carries the refusal, and the refresh
      // puts what the server knows now — a balance that moved since this was
      // drawn — back under the button.
      setOpen(false);
      if (!result.ok) {
        toast.error(result.error ?? t("leaveFailed"));
        router.refresh();
        return;
      }
      toast.success(t("left", { group: groupName }));
      // Replaced rather than pushed: Back would land on a group they can no
      // longer open.
      router.replace("/dashboard");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3.5">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            className="h-[38px] self-start px-3"
            disabled={reason !== null}
            aria-describedby={reasonId}
          >
            <LogOut aria-hidden="true" />
            {t("leaveGroup")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("leaveTitle", { group: groupName })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("leaveBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t("stayInGroup")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void onLeave();
              }}
              disabled={pending}
            >
              {pending && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              {t("leave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <span id={reasonId} className="text-xs text-pretty text-muted-foreground">
        {reason ?? t("leaveHint")}
      </span>
    </div>
  );
}
