"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimezoneSelect } from "@/components/groups/timezone-select";
import { updateGroupAction } from "@/modules/groups/actions";

export function GroupSettingsForm({
  groupId,
  name,
  description,
  timezone,
}: {
  groupId: string;
  name: string;
  description?: string | null;
  timezone: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onSubmit = async (formData: FormData) => {
    setPending(true);
    try {
      const result = await updateGroupAction(groupId, formData);
      if (!result.ok) {
        toast.error(result.error ?? "Those changes could not be saved.");
        return;
      }
      toast.success("Settings saved");
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Details</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              name="name"
              defaultValue={name}
              required
              maxLength={120}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="group-description">
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="group-description"
              name="description"
              defaultValue={description ?? ""}
              rows={2}
              maxLength={2000}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="group-timezone">Timezone</Label>
            <TimezoneSelect
              id="group-timezone"
              name="timezone"
              defaultValue={timezone}
            />
            <p className="text-xs text-muted-foreground">
              Recurring expenses are generated according to this timezone.
            </p>
          </div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
