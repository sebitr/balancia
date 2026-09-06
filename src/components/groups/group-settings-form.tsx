"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toastUndoable } from "@/components/ui/sonner";
import { useAutosave } from "@/components/ui/use-autosave";
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

/** What `updateGroupAction` reads, which is every field on every write. */
function formDataFor(draft: Draft): FormData {
  const data = new FormData();
  data.set("name", draft.name);
  data.set("description", draft.description);
  // Silence would leave the stored icon alone, so this always says.
  data.set("icon", draft.icon ?? "");
  data.set("iconColor", draft.color);
  data.set("timezone", draft.timezone);
  return data;
}

/**
 * What the group calls itself.
 *
 * Nothing here is saved by pressing anything: `useAutosave` owns the timing,
 * the ordering and the way back, and this card says what to write and what to
 * call it. A field that is typed in goes once the typing stops or the field is
 * left, the timezone goes as it is chosen, and the two choices in the icon
 * sheet are held until it closes — one write for a visit to it rather than one
 * per tap.
 *
 * One toast, named for this group, so a run of edits replaces the one already
 * on screen rather than stacking a column of them; its Undo restores the
 * values as they stood before the run began.
 *
 * An empty name is the one thing that stops all this: the server would refuse
 * it and the group list would have nothing left to show, so the field says so
 * and nothing is sent until it is filled in again.
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

  const [pickerOpen, setPickerOpen] = useState(false);

  const { draft, saving, edit, flush } = useAutosave<Draft>({
    initial: stored,
    same,
    // The server would refuse an empty name, and the group list would have
    // nothing left to show for this group.
    ready: (next) => next.name.trim() !== "",
    write: async (next) => {
      const result = await updateGroupAction(groupId, formDataFor(next));
      if (!result.ok) {
        toast.error(result.error ?? t("failed"));
        return false;
      }
      return true;
    },
    announce: (undo) =>
      toastUndoable(
        t("saved"),
        { label: tCommon("undo"), onUndo: undo },
        // One toast for this group's settings, replaced rather than repeated.
        { id: `group-settings-${groupId}` },
      ),
    // The header, the group list and the nav were all drawn by the server with
    // the old name on them. Once, at the end of a run, rather than per
    // keystroke.
    settled: () => router.refresh(),
  });

  const closePicker = () => {
    setPickerOpen(false);
    flush();
  };

  const nameMissing = draft.name.trim() === "";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("details")}</CardTitle>
          {/* For the eye only: the toast is what announces the outcome, and a
              reader who is told "Saving…" and then "Changes saved" for every
              pause in their typing has been told twice. */}
          <CardAction>
            {saving && (
              <span
                aria-hidden="true"
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <Loader2 className="size-3.5 animate-spin" />
                {t("saving")}
              </span>
            )}
          </CardAction>
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
                  className="size-10 rounded-lg bg-wash-2 text-muted-foreground"
                  iconClassName="size-5"
                />
              </button>
              <Input
                id={`${fieldId}name`}
                name="name"
                value={draft.name}
                onChange={(event) => edit({ name: event.target.value })}
                onBlur={flush}
                required
                aria-invalid={nameMissing}
                aria-describedby={
                  nameMissing ? `${fieldId}name-error` : undefined
                }
                maxLength={120}
                autoComplete="off"
                className="h-10 flex-1"
              />
            </div>
            {nameMissing && (
              <p
                id={`${fieldId}name-error`}
                className="text-sm text-destructive"
              >
                {t("nameRequired")}
              </p>
            )}
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
              onBlur={flush}
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
              onValueChange={(zone) => edit({ timezone: zone }, "chosen")}
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

      <Sheet
        open={pickerOpen}
        onOpenChange={(open) => (open ? setPickerOpen(true) : closePicker())}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          // Content-height, unlike the create sheet: this is one short view
          // rather than a form with a picker behind it.
          className="max-h-[calc(100dvh-48px-env(safe-area-inset-top))] gap-0 overflow-hidden rounded-t-[28px] bg-card text-card-foreground"
        >
          <GroupIconPicker
            name={draft.name}
            onName={(value) => edit({ name: value }, "held")}
            icon={draft.icon}
            color={draft.color}
            onIcon={(chosen) => edit({ icon: chosen }, "held")}
            onColor={(chosen) => edit({ color: chosen }, "held")}
            onBack={closePicker}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
