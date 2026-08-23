"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, ArchiveRestore, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { toastUndoable } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  deleteGroupAction,
  setGroupArchivedAction,
} from "@/modules/groups/actions";

/**
 * Archiving and deletion.
 *
 * Deleting a group destroys every expense, settlement and receipt in it, so it
 * requires typing the group's name — a confirmation that cannot be clicked
 * through by muscle memory.
 */
export function DangerZone({
  groupId,
  groupName,
  archived,
}: {
  groupId: string;
  groupName: string;
  archived: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("dangerZone");
  const tCommon = useTranslations("common");
  const [confirmName, setConfirmName] = useState("");
  const [pending, setPending] = useState(false);

  /** Reports whether it landed, so the undo can be offered only if it did. */
  const setArchived = async (next: boolean) => {
    const result = await setGroupArchivedAction(groupId, next);
    if (!result.ok) {
      toast.error(result.error ?? t("failed"));
      return false;
    }
    router.refresh();
    return true;
  };

  const onToggleArchive = async () => {
    setPending(true);
    try {
      if (!(await setArchived(!archived))) return;
      // `archived` is the state this started from, which is exactly where the
      // undo has to put it back — the prop underneath will have moved on.
      toastUndoable(archived ? t("restored") : t("archived"), {
        label: tCommon("undo"),
        onUndo: () => setArchived(archived),
      });
    } finally {
      setPending(false);
    }
  };

  const onDelete = async () => {
    setPending(true);
    try {
      const result = await deleteGroupAction(groupId);
      // A successful delete redirects, so reaching here means it failed.
      if (result && !result.ok) {
        toast.error(result.error ?? t("deleteFailed"));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      {/* Each row explains itself on the left and acts on the right. Nothing
          here is destructive to look at — only the one button that is. */}
      <CardContent className="flex flex-col gap-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {archived ? t("restoreTitle") : t("archiveTitle")}
            </p>
            <p className="mt-0.5 text-xs text-pretty text-muted-foreground">
              {archived ? t("restoreBody") : t("archiveBody")}
            </p>
          </div>
          <Button
            className="shrink-0"
            variant="outline"
            size="sm"
            onClick={() => void onToggleArchive()}
            disabled={pending}
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : archived ? (
              <ArchiveRestore aria-hidden="true" />
            ) : (
              <Archive aria-hidden="true" />
            )}
            {archived ? t("restore") : t("archive")}
          </Button>
        </div>

        <div className="flex items-start justify-between gap-3 border-t pt-3.5">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("deleteTitle")}</p>
            <p className="mt-0.5 text-xs text-pretty text-muted-foreground">
              {t("deleteBody")}
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="shrink-0">
                <Trash2 aria-hidden="true" />
                {t("delete")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("confirmTitle", { name: groupName })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("confirmBody")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <Label htmlFor="confirm-group-name">
                  {t.rich("typeToConfirm", {
                    name: () => <strong>{groupName}</strong>,
                  })}
                </Label>
                <Input
                  id="confirm-group-name"
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>
                  {tCommon("cancel")}
                </AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={confirmName !== groupName || pending}
                  onClick={() => void onDelete()}
                >
                  {pending && (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  )}
                  {t("deletePermanently")}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
