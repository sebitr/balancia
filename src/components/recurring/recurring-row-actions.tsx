"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MoreVertical, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { toastUndoable } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  deleteRecurringAction,
  restoreRecurringAction,
  setRecurringPausedAction,
} from "@/modules/recurring/actions";

export function RecurringRowActions({
  groupId,
  templateId,
  description,
  paused,
}: {
  groupId: string;
  templateId: string;
  description: string;
  paused: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("recurringActions");
  const tCommon = useTranslations("common");
  const [confirmOpen, setConfirmOpen] = useState(false);

  /** Reports whether it landed, so the undo can be offered only if it did. */
  const setPaused = async (next: boolean) => {
    const result = await setRecurringPausedAction(groupId, templateId, next);
    if (!result.ok) {
      toast.error(result.error ?? t("failed"));
      return false;
    }
    router.refresh();
    return true;
  };

  /**
   * Puts the template back. Its schedule comes back with it: the worker works
   * out the next date on its own tick, so a template removed and restored in
   * the same minute never misses one.
   */
  const onRestore = async () => {
    const result = await restoreRecurringAction(groupId, templateId);
    if (!result.ok) {
      toast.error(result.error ?? t("restoreFailed"));
      return;
    }
    router.refresh();
    toast.success(t("restored"));
  };

  const onTogglePause = async () => {
    if (!(await setPaused(!paused))) return;
    // `paused` is where this started, which is where the undo puts it back.
    toastUndoable(paused ? t("resumed") : t("paused"), {
      label: tCommon("undo"),
      onUndo: () => setPaused(paused),
    });
  };

  const onDelete = async () => {
    const result = await deleteRecurringAction(groupId, templateId);
    if (!result.ok) {
      toast.error(result.error ?? t("failed"));
      return;
    }
    toastUndoable(t("removed"), {
      label: tCommon("undo"),
      onUndo: onRestore,
    });
    setConfirmOpen(false);
    router.refresh();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("actionsFor", { description })}
          >
            <MoreVertical aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void onTogglePause()}>
            {paused ? (
              <>
                <Play aria-hidden="true" />
                {t("resume")}
              </>
            ) : (
              <>
                <Pause aria-hidden="true" />
                {t("pause")}
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setConfirmOpen(true);
            }}
          >
            <Trash2 aria-hidden="true" />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("removeTitle", { description })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("removeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("keep")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void onDelete();
              }}
            >
              {t("remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
