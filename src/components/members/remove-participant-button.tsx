"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { removeParticipantAction } from "@/modules/groups/actions";

export function RemoveParticipantButton({
  groupId,
  participantId,
  displayName,
}: {
  groupId: string;
  participantId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onConfirm = async () => {
    setPending(true);
    try {
      const result = await removeParticipantAction(groupId, participantId);
      if (!result.ok) {
        toast.error(result.error ?? "That person could not be removed.");
        return;
      }
      toast.success(`${displayName} removed`);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${displayName} from the group`}
        >
          <UserMinus aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {displayName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Their past expenses and payments stay in the group so balances
            remain correct — they simply cannot be added to anything new. Any
            guest link they hold stops working.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
            disabled={pending}
          >
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
