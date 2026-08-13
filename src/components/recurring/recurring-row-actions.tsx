"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MoreVertical, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const onTogglePause = async () => {
    const result = await setRecurringPausedAction(groupId, templateId, !paused);
    if (!result.ok) {
      toast.error(result.error ?? t("failed"));
      return;
    }
    toast.success(paused ? t("resumed") : t("paused"));
    router.refresh();
  };

  const onDelete = async () => {
    const result = await deleteRecurringAction(groupId, templateId);
    if (!result.ok) {
      toast.error(result.error ?? t("failed"));
      return;
    }
    toast.success(t("removed"));
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
