"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("groupSettings");
  const tCommon = useTranslations("common");
  const [pending, setPending] = useState(false);
  // The group already has a zone, and it is nobody's device that decides it —
  // no detection here, unlike group creation.
  const [zone, setZone] = useState(timezone);

  const onSubmit = async (formData: FormData) => {
    setPending(true);
    try {
      const result = await updateGroupAction(groupId, formData);
      if (!result.ok) {
        toast.error(result.error ?? t("failed"));
        return;
      }
      toast.success(t("saved"));
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("details")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">{t("name")}</Label>
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
              {t("description")}{" "}
              <span className="font-normal text-muted-foreground">
                ({tCommon("optional")})
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
            <Label htmlFor="group-timezone">{t("timezone")}</Label>
            <TimezoneSelect
              id="group-timezone"
              name="timezone"
              value={zone}
              onValueChange={setZone}
            />
            <p className="text-xs text-muted-foreground">{t("timezoneHelp")}</p>
          </div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {t("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
