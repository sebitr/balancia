"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addParticipantAction } from "@/modules/groups/actions";

export function AddParticipantForm({ groupId }: { groupId: string }) {
  const router = useRouter();
  const t = useTranslations("members");
  const tCommon = useTranslations("common");
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (formData: FormData) => {
    setPending(true);
    try {
      const result = await addParticipantAction(groupId, formData);
      if (!result.ok) {
        toast.error(result.error ?? t("addFailed"));
        return;
      }
      toast.success(t("added"));
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
      <h2 className="font-medium">{t("addTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="displayName">{t("name")}</Label>
          <Input id="displayName" name="displayName" required maxLength={120} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="participant-email">
            {t("email")}{" "}
            <span className="font-normal text-muted-foreground">
              ({tCommon("optional")})
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
        {t("addPerson")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("addNote")}</p>
    </form>
  );
}
