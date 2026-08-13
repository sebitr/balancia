"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const [confirmName, setConfirmName] = useState("");
  const [pending, setPending] = useState(false);

  const onToggleArchive = async () => {
    setPending(true);
    try {
      const result = await setGroupArchivedAction(groupId, !archived);
      if (!result.ok) {
        toast.error(result.error ?? "That did not work.");
        return;
      }
      toast.success(archived ? "Group restored" : "Group archived");
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
        toast.error(result.error ?? "The group could not be deleted.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">
              {archived ? "Restore this group" : "Archive this group"}
            </p>
            <p className="text-sm text-muted-foreground">
              {archived
                ? "Make it editable again."
                : "Keeps everything, but stops new expenses being added."}
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
            {archived ? "Restore" : "Archive"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div>
            <p className="text-sm font-medium">Delete this group</p>
            <p className="text-sm text-muted-foreground">
              Removes every expense, payment and receipt. Cannot be undone.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{groupName}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  Every expense, payment, receipt and invitation in this group
                  is permanently removed. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <Label htmlFor="confirm-group-name">
                  Type <strong>{groupName}</strong> to confirm
                </Label>
                <Input
                  id="confirm-group-name"
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={confirmName !== groupName || pending}
                  onClick={() => void onDelete()}
                >
                  {pending && (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  )}
                  Delete permanently
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
