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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CurrencySelect } from "@/components/money/currency-select";
import { TimezoneSelect } from "@/components/groups/timezone-select";
import { ParticipantNamesField } from "@/components/groups/participant-names-field";
import { createGroupAction } from "@/modules/groups/actions";
import type { CurrencyMode } from "@/modules/currencies/conversion";

/**
 * Group creation.
 *
 * The currency-mode choice is the one decision that is awkward to change
 * later, so both options are spelled out rather than hidden behind a toggle.
 */
export function CreateGroupForm({
  defaultName,
  defaultTimezone,
}: {
  defaultName: string;
  defaultTimezone: string;
}) {
  const router = useRouter();
  const t = useTranslations("groupForm");
  const tCommon = useTranslations("common");
  const [mode, setMode] = useState<CurrencyMode>("separate");
  const [ownerName, setOwnerName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (formData: FormData) => {
    setError(null);
    setPending(true);
    try {
      const result = await createGroupAction(formData);
      if (!result.ok || !result.data) {
        setError(result.error ?? t("failed"));
        return;
      }
      toast.success(t("created"));
      router.push(`/groups/${result.data.groupId}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <form action={onSubmit} className="space-y-6" noValidate>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={120}
          placeholder={t("namePlaceholder")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">
          {t("description")}{" "}
          <span className="font-normal text-muted-foreground">
            ({tCommon("optional")})
          </span>
        </Label>
        <Textarea
          id="description"
          name="description"
          maxLength={2000}
          rows={2}
          placeholder={t("descriptionPlaceholder")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ownerDisplayName">{t("yourName")}</Label>
        <Input
          id="ownerDisplayName"
          name="ownerDisplayName"
          value={ownerName}
          onChange={(event) => setOwnerName(event.target.value)}
          required
          maxLength={120}
        />
        <p className="text-xs text-muted-foreground">{t("yourNameHelp")}</p>
      </div>

      <ParticipantNamesField ownerLabel={ownerName} />

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t("currencyLegend")}</legend>
        <RadioGroup
          name="currencyMode"
          value={mode}
          onValueChange={(value) => setMode(value as CurrencyMode)}
          className="gap-3"
        >
          <label
            htmlFor="mode-separate"
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-accent/60"
          >
            <RadioGroupItem
              value="separate"
              id="mode-separate"
              className="mt-0.5"
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">
                {t("separateTitle")}
              </span>
              <span className="block text-sm text-muted-foreground">
                {t("separateBody")}
              </span>
            </span>
          </label>

          <label
            htmlFor="mode-converted"
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-accent/60"
          >
            <RadioGroupItem
              value="converted"
              id="mode-converted"
              className="mt-0.5"
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">
                {t("convertedTitle")}
              </span>
              <span className="block text-sm text-muted-foreground">
                {t("convertedBody")}
              </span>
            </span>
          </label>
        </RadioGroup>
      </fieldset>

      {mode === "converted" && (
        <div className="space-y-2">
          <Label htmlFor="baseCurrency">{t("baseCurrency")}</Label>
          <CurrencySelect
            id="baseCurrency"
            name="baseCurrency"
            defaultValue="EUR"
            required
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="timezone">{t("timezone")}</Label>
        <TimezoneSelect
          id="timezone"
          name="timezone"
          defaultValue={defaultTimezone}
        />
        <p className="text-xs text-muted-foreground">{t("timezoneHelp")}</p>
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
        {t("submit")}
      </Button>
    </form>
  );
}
