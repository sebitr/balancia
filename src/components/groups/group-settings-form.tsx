"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CurrencyModeNote } from "@/components/groups/currency-mode-note";
import { GroupIconPicker } from "@/components/groups/group-icon-picker";
import { GroupIconTile } from "@/components/groups/group-icon";
import { TimezoneSelect } from "@/components/groups/timezone-select";
import { updateGroupAction } from "@/modules/groups/actions";
import {
  DEFAULT_GROUP_ICON_COLOR,
  type GroupIcon,
  type GroupIconColor,
} from "@/modules/groups/icons";
import type { CurrencyMode } from "@/modules/currencies/conversion";

/** Everything on this screen that a save writes back. */
interface Draft {
  readonly name: string;
  readonly description: string;
  readonly icon: GroupIcon | null;
  readonly color: GroupIconColor;
  readonly timezone: string;
}

function same(a: Draft, b: Draft): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.icon === b.icon &&
    a.color === b.color &&
    a.timezone === b.timezone
  );
}

/**
 * What the group calls itself.
 *
 * There is no Save button in the card. Changing anything raises a bar over the
 * bottom navigation instead, and it stays there until the change is saved or
 * discarded — so the answer to "did that take?" is on screen rather than in
 * the memory of having pressed something.
 *
 * That means the persisted values are held here as well as the draft: the bar
 * appears when the two differ, Discard copies one onto the other, and a save
 * moves the baseline forward without waiting for the refresh to bring the new
 * record back.
 *
 * The currency mode is the one thing here that cannot be edited, and it sits
 * at the foot of the same card rather than in one of its own — it is a fact
 * about the group's identity, like its name.
 */
export function GroupSettingsForm({
  groupId,
  name,
  description,
  icon,
  color,
  timezone,
  currencyMode,
  baseCurrency,
}: {
  groupId: string;
  name: string;
  description?: string | null;
  icon: GroupIcon | null;
  color: GroupIconColor | null;
  timezone: string;
  currencyMode: CurrencyMode;
  baseCurrency: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("groupSettings");
  const tCommon = useTranslations("common");
  const fieldId = useId();

  // A group with no accent still has to hand the picker one to start from, so
  // the fallback is applied on the way in rather than at every use.
  const stored: Draft = {
    name,
    description: description ?? "",
    icon,
    color: color ?? DEFAULT_GROUP_ICON_COLOR,
    timezone,
  };

  const [persisted, setPersisted] = useState(stored);
  const [draft, setDraft] = useState(stored);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const dirty = !same(draft, persisted);
  const edit = (changes: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...changes }));

  const onSubmit = async (formData: FormData) => {
    // Read before the await: the draft this save is for, not whatever it has
    // become by the time the server answers.
    const saving = draft;
    setPending(true);
    try {
      const result = await updateGroupAction(groupId, formData);
      if (!result.ok) {
        toast.error(result.error ?? t("failed"));
        return;
      }
      setPersisted(saving);
      toast.success(t("saved"));
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <form action={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>{t("details")}</CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}name`}>{t("nameAndIcon")}</Label>
            <div className="flex items-center gap-2.5">
              {/* The same picker the group was created with, reached from the
                  same tile beside the same field. */}
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-label={t("changeIcon")}
                className="rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <GroupIconTile
                  icon={draft.icon}
                  color={draft.color}
                  name={draft.name}
                  className="size-10 rounded-lg bg-foreground/5 text-muted-foreground"
                  iconClassName="size-5"
                />
              </button>
              <Input
                id={`${fieldId}name`}
                name="name"
                value={draft.name}
                onChange={(event) => edit({ name: event.target.value })}
                required
                maxLength={120}
                autoComplete="off"
                className="h-10 flex-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${fieldId}description`} className="gap-1.5">
              {t("description")}
              <span className="font-normal text-muted-foreground">
                {tCommon("optional")}
              </span>
            </Label>
            <Textarea
              id={`${fieldId}description`}
              name="description"
              value={draft.description}
              onChange={(event) => edit({ description: event.target.value })}
              rows={2}
              maxLength={2000}
              placeholder={t("descriptionPlaceholder")}
              className="min-h-14"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${fieldId}timezone`}>{t("timezone")}</Label>
            {/* The group already has a zone, and it is nobody's device that
                decides it — no detection here, unlike group creation. */}
            <TimezoneSelect
              id={`${fieldId}timezone`}
              name="timezone"
              value={draft.timezone}
              onValueChange={(zone) => edit({ timezone: zone })}
            />
            <p className="text-xs text-muted-foreground">{t("timezoneHelp")}</p>
          </div>
        </CardContent>

        <div className="border-t px-(--card-spacing) pt-(--card-spacing)">
          <CurrencyModeNote
            currencyMode={currencyMode}
            baseCurrency={baseCurrency}
          />
        </div>
      </Card>

      {/* What the picker chose; no visible control submits these. */}
      <input type="hidden" name="icon" value={draft.icon ?? ""} />
      <input type="hidden" name="iconColor" value={draft.color} />

      <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          // Content-height, unlike the create sheet: this is one short view
          // rather than a form with a picker behind it.
          className="max-h-[calc(100dvh-48px-env(safe-area-inset-top))] gap-0 overflow-hidden rounded-t-[28px] bg-card p-0 text-card-foreground"
        >
          <GroupIconPicker
            name={draft.name}
            onName={(value) => edit({ name: value })}
            icon={draft.icon}
            color={draft.color}
            onIcon={(chosen) => edit({ icon: chosen })}
            onColor={(chosen) => edit({ color: chosen })}
            onBack={() => setPickerOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {dirty && (
        // Above the bottom bar rather than over it, and pinned to the same
        // column the content is capped at. The offset is the bar's own height:
        // see `GroupNav`, which owns the safe area below it.
        <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 border-t bg-card motion-safe:animate-in motion-safe:duration-[180ms] motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-full">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
            {/* Truncated rather than wrapped: a language with a longer word
                for this must not make the bar three lines tall. */}
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {t("unsaved")}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setDraft(persisted)}
              >
                {t("discard")}
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending && (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                )}
                {t("save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
