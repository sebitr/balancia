"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const onTogglePause = async () => {
    const result = await setRecurringPausedAction(groupId, templateId, !paused);
    if (!result.ok) {
      toast.error(result.error ?? "That did not work.");
      return;
    }
    toast.success(paused ? "Resumed" : "Paused");
    router.refresh();
  };

  const onDelete = async () => {
    const result = await deleteRecurringAction(groupId, templateId);
    if (!result.ok) {
      toast.error(result.error ?? "That did not work.");
      return;
    }
    toast.success("Recurring expense removed");
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
            aria-label={`Actions for ${description}`}
          >
            <MoreVertical aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void onTogglePause()}>
            {paused ? (
              <>
                <Play aria-hidden="true" />
                Resume
              </>
            ) : (
              <>
                <Pause aria-hidden="true" />
                Pause
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
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{description}”?</AlertDialogTitle>
            <AlertDialogDescription>
              No further expenses will be generated. Expenses it has already
              created stay in the group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void onDelete();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
