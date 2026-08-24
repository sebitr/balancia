"use client";

import { useEffect, useId, useRef, useState } from "react";
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
import { toastUndoable, UNDO_WINDOW } from "@/components/ui/sonner";
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

/** How long typing has to stop before what was typed is sent. */
const QUIET = 800;

/**
 * What the group calls itself.
 *
 * Nothing here is saved by pressing anything. A field that is typed in goes
 * once the typing stops or the field is left, a control that is chosen goes as
 * it is chosen, and the two choices in the icon sheet go together when the
 * sheet closes — one write for a visit to it rather than one per tap.
 *
 * The confirmation carries the way back. Each write raises the same named
 * toast, so a run of edits replaces the one already on screen instead of
 * stacking a column of them, and its Undo restores the values as they stood
 * before that run began rather than before its last keystroke — the baseline
 * is taken at the first save of the run and forgotten when the toast goes.
 * Undoing is written like any other change but announces nothing: the fields
 * going back to what they were is the answer.
 *
 * So the draft is held twice — as state, which the fields read, and as refs,
 * which a write that started a keystroke ago reads. `persisted` is what the
 * server is known to hold; it moves forward on a save rather than waiting for
 * the refresh to bring the new record back.
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

  const [draft, setDraft] = useState(stored);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const draftNow = useRef(stored);
  const persisted = useRef(stored);
  const inFlight = useRef(false);
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What Undo would put back, and the timer that forgets it once the toast
  // offering it has gone.
  const undoTo = useRef<Draft | null>(null);
  const forget = useRef<ReturnType<typeof setTimeout> | null>(null);

  // One toast for this group's settings, replaced rather than repeated.
  const toastId = `group-settings-${groupId}`;

  const clear = (
    timer: React.RefObject<ReturnType<typeof setTimeout> | null>,
  ) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  /** Puts a whole run of edits back, and writes that without announcing it. */
  const undo = (back: Draft) => {
    undoTo.current = null;
    clear(forget);
    clear(quiet);
    draftNow.current = back;
    setDraft(back);
    void save(false);
  };

  const offerUndo = (before: Draft) => {
    undoTo.current ??= before;
    const back = undoTo.current;
    clear(forget);
    forget.current = setTimeout(() => {
      undoTo.current = null;
    }, UNDO_WINDOW);

    toastUndoable(
      t("saved"),
      { label: tCommon("undo"), onUndo: () => undo(back) },
      { id: toastId },
    );
  };

  /**
   * Writes the newest draft, and then whatever it became while that one was in
   * the air. A refused write is not retried on its own — the next edit is the
   * retry, and until then the card still shows what was typed.
   */
  const save = async (announce = true): Promise<void> => {
    if (inFlight.current) return;
    const next = draftNow.current;
    const before = persisted.current;
    if (same(next, before) || next.name.trim() === "") return;

    inFlight.current = true;
    setSaving(true);
    try {
      const result = await updateGroupAction(groupId, formDataFor(next));
      if (!result.ok) {
        toast.error(result.error ?? t("failed"));
        return;
      }
      persisted.current = next;
      if (announce) offerUndo(before);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }

    if (!same(draftNow.current, persisted.current)) {
      await save();
      return;
    }
    // The header, the group list and the nav were all drawn by the server with
    // the old name on them. Once, at the end of the run, rather than once per
    // keystroke.
    router.refresh();
  };

  /**
   * A change to the draft, and when it is written: typing waits for a pause, a
   * control that is chosen goes at once, and what the icon sheet changes is
   * held until it closes.
   */
  const edit = (
    changes: Partial<Draft>,
    when: "typed" | "chosen" | "held" = "typed",
  ) => {
    const next = { ...draftNow.current, ...changes };
    draftNow.current = next;
    setDraft(next);

    clear(quiet);
    if (when === "held") return;
    if (when === "chosen") {
      void save();
      return;
    }
    quiet.current = setTimeout(() => void save(), QUIET);
  };

  const closePicker = () => {
    setPickerOpen(false);
    void save();
  };

  // The newest `save`, for a cleanup that must not close over a stale draft.
  const latest = useRef(save);
  useEffect(() => {
    latest.current = save;
  });

  useEffect(
    () => () => {
      clear(quiet);
      clear(forget);
      // Typing and then leaving is still a change: it goes with them.
      void latest.current();
    },
    [],
  );

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
                  className="size-10 rounded-lg bg-foreground/5 text-muted-foreground"
                  iconClassName="size-5"
                />
              </button>
              <Input
                id={`${fieldId}name`}
                name="name"
                value={draft.name}
                onChange={(event) => edit({ name: event.target.value })}
                onBlur={() => void save()}
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
              onBlur={() => void save()}
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
          className="max-h-[calc(100dvh-48px-env(safe-area-inset-top))] gap-0 overflow-hidden rounded-t-[28px] bg-card p-0 text-card-foreground"
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
