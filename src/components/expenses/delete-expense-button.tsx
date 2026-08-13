"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
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
import { deleteExpenseAction } from "@/modules/expenses/actions";

/** Destructive action, so it always asks first and names what it will remove. */
export function DeleteExpenseButton({
  groupId,
  expenseId,
  description,
}: {
  groupId: string;
  expenseId: string;
  description: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onConfirm = async () => {
    setPending(true);
    try {
      const result = await deleteExpenseAction(groupId, expenseId);
      if (!result.ok) {
        toast.error(result.error ?? "The expense could not be deleted.");
        return;
      }
      toast.success("Expense deleted");
      router.push(`/groups/${groupId}/expenses`);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="text-destructive">
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
          <AlertDialogDescription>
            “{description}” will be removed from the group and balances will be
            recalculated without it. This cannot be undone from the app.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
            disabled={pending}
          >
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            Delete expense
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
