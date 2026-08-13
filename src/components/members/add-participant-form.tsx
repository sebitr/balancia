"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addParticipantAction } from "@/modules/groups/actions";

export function AddParticipantForm({ groupId }: { groupId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (formData: FormData) => {
    setPending(true);
    try {
      const result = await addParticipantAction(groupId, formData);
      if (!result.ok) {
        toast.error(result.error ?? "That person could not be added.");
        return;
      }
      toast.success("Added to the group");
      formRef.current?.reset();
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      ref={formRef}
      action={onSubmit}
      className="space-y-3 rounded-lg border p-4"
    >
      <h2 className="font-medium">Add someone</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="displayName">Name</Label>
          <Input id="displayName" name="displayName" required maxLength={120} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="participant-email">
            Email{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input id="participant-email" name="email" type="email" />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <UserPlus aria-hidden="true" />
        )}
        Add person
      </Button>
      <p className="text-xs text-muted-foreground">
        People added this way have no account. You can give them a guest link so
        they can take part.
      </p>
    </form>
  );
}
