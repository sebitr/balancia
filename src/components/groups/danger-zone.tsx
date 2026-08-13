"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, ArchiveRestore, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
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

  const onToggleArchive = async () => {
    setPending(true);
    try {
      const result = await setGroupArchivedAction(groupId, !archived);
      if (!result.ok) {
        toast.error(result.error ?? t("failed"));
        return;
      }
      toast.success(archived ? t("restored") : t("archived"));
      router.refresh();
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
    <Card className="border-destructive/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">
              {archived ? t("restoreTitle") : t("archiveTitle")}
            </p>
            <p className="text-sm text-muted-foreground">
              {archived ? t("restoreBody") : t("archiveBody")}
            </p>
          </div>
          <Button
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div>
            <p className="text-sm font-medium">{t("deleteTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("deleteBody")}</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
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
