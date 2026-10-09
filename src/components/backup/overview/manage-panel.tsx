"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronRight,
  CloudUpload,
  KeyRound,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { Switch } from "@/components/ui/switch";
import type { Autosave } from "@/components/ui/use-autosave";
import { ConfirmSheet } from "@/components/settings/confirm-sheet";
import { SettingsControlRow } from "@/components/settings/settings-row";
import { formatBytes } from "@/components/backup/format";
import { useDateFormatter, useNumberLocale } from "@/i18n/format-context";
import {
  estimateReceiptsAction,
  removeDestinationAction,
} from "@/modules/backup/actions";
import { PROVIDER_NAMES } from "@/modules/backup/providers";
import type { DestinationView } from "@/modules/backup/service";
import type { Draft } from "./use-destination-draft";

/**
 * Everything about a destination that can be changed, behind one disclosure.
 *
 * Closed by default: the card above it answers the questions most visits come
 * for, and the controls here are the ones touched once a quarter. None of them
 * has a Save button. Each is written the moment it is pressed, by the draft the
 * card owns, and pressing it again is the way back — so none of them says
 * anything when it works. The only thing spoken is a refusal, by the draft.
 *
 * Three rows end it, and they are the three things that are not a toggle:
 * moving the backup somewhere else (a screen of its own), making a new
 * recovery key (a screen of its own, after a question), and stopping (a
 * question, then gone). Those two questions are the only places the overview
 * asks twice — everything else can be pressed back.
 */

/** The choices for "Backups to keep". A stored value outside them is shown too. */
const KEEP_CHOICES = [5, 10, 20, 30] as const;

/** Groups listed before "Show all": enough to see what is ticked at a glance. */
const GROUPS_SHOWN = 4;

/** Past this the estimate adds its quiet line: a free cloud plan is a few GB. */
const BIG_RECEIPTS_BYTES = 1_000_000_000;

/** `9f3a07c2` → `9f3a 07c2`, how the key is named on a screen. */
function spaced(fingerprint: string): string {
  return fingerprint.replace(/(.{4})(?=.)/g, "$1 ");
}

/** A group this person owns, as far as Manage needs to draw it. */
export interface ManageGroup {
  readonly id: string;
  readonly name: string;
  readonly participantCount?: number;
  readonly lastActivityAt?: Date | null;
}

const ROW =
  "flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-wash-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:-outline-offset-2 focus-visible:outline-none";

export function ManagePanel({
  destination,
  groups,
  draft,
  edit,
  keyFingerprint,
}: {
  destination: DestinationView;
  /** The groups this person owns — the only ones a backup can include. */
  groups: readonly ManageGroup[];
  draft: Draft;
  edit: Autosave<Draft>["edit"];
  keyFingerprint: string | null;
}) {
  const t = useTranslations("cloudBackup");
  const tSettings = useTranslations("userSettings");
  const router = useRouter();
  const numberLocale = useNumberLocale();
  const dates = useDateFormatter();
  const ids = useId();
  const provider = PROVIDER_NAMES[destination.provider];

  const [showAll, setShowAll] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [estimate, setEstimate] = useState<{
    count: number;
    bytes: number;
  } | null>(null);

  const ticked = groups.filter(
    (group) => !draft.excludedGroupIds.includes(group.id),
  );
  const shownGroups = showAll ? groups : groups.slice(0, GROUPS_SHOWN);

  // What the receipts would come to for the groups as they are ticked. Asked
  // again whenever the ticks change, and a slow answer to an old question is
  // dropped rather than painted over the new one.
  const excluded = [...draft.excludedGroupIds].sort().join(",");
  useEffect(() => {
    if (!draft.includeReceipts) return;
    let current = true;
    estimateReceiptsAction(excluded ? excluded.split(",") : [])
      .then((result) => {
        if (current && result.ok && result.data) setEstimate(result.data);
      })
      // An estimate is a courtesy: with none, the switch still works.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [draft.includeReceipts, excluded]);

  const keepChoices: number[] = [...KEEP_CHOICES];
  if (!keepChoices.includes(draft.keepLast)) {
    keepChoices.push(draft.keepLast);
    keepChoices.sort((a, b) => a - b);
  }

  const tick = (groupId: string, on: boolean) => {
    // A backup of nothing is not a backup. The last tick stays where it is, and
    // the refusal is spoken, because nothing on screen says why it did not move.
    if (!on && ticked.length === 1 && ticked[0]?.id === groupId) {
      toast.error(t("overview.refused"));
      return;
    }
    const others = draft.excludedGroupIds.filter((id) => id !== groupId);
    edit({ excludedGroupIds: on ? others : [...others, groupId] }, "chosen");
  };

  const stop = async () => {
    let gone = false;
    try {
      const result = await removeDestinationAction(destination.id);
      gone = result.ok && !(result.data && !result.data.ok);
    } catch {
      gone = false;
    }
    if (!gone) {
      // The sheet stays open, so the question can be asked again.
      toast.error(t("overview.refused"));
      return;
    }
    setRemoving(false);
    router.refresh();
  };

  const startRotation = () => {
    setRotating(false);
    router.push("/settings/backup/setup?step=key&rotate=1");
  };

  return (
    <div className="space-y-5 pt-1">
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold">
          {t("what.scheduleTitle")}
        </legend>
        <div className="flex flex-wrap gap-2">
          {(["daily", "weekly"] as const).map((frequency) => (
            <Chip
              key={frequency}
              selected={draft.frequency === frequency}
              label={t(`schedule.${frequency}`)}
              onClick={() => edit({ frequency }, "chosen")}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold">{t("what.keepLabel")}</legend>
        <div className="flex flex-wrap gap-2">
          {keepChoices.map((count) => (
            <Chip
              key={count}
              selected={draft.keepLast === count}
              label={String(count)}
              onClick={() => edit({ keepLast: count }, "chosen")}
            />
          ))}
        </div>
        <p className="text-xs text-pretty text-muted-foreground">
          {t("what.keepHelp")}
        </p>
      </fieldset>

      <section className="space-y-1 border-t border-border pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-xs font-semibold">
            {t("overview.groupsInManage")}
          </h3>
          <span className="text-xs text-muted-foreground">
            {t("what.count", { count: ticked.length, total: groups.length })}
          </span>
        </div>
        <ul>
          {shownGroups.map((group) => {
            const id = `${ids}-group-${group.id}`;
            const facts = [
              group.participantCount !== undefined &&
                t("what.members", { count: group.participantCount }),
              group.lastActivityAt &&
                t("what.changed", {
                  date: dates.at(group.lastActivityAt, { style: "dayMonth" }),
                }),
            ].filter(Boolean);
            return (
              <li
                key={group.id}
                className="relative before:absolute before:inset-x-0 before:top-0 before:ml-7 before:border-t before:border-border first:before:hidden"
              >
                <label
                  htmlFor={id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 py-1"
                >
                  <Checkbox
                    id={id}
                    checked={!draft.excludedGroupIds.includes(group.id)}
                    onCheckedChange={(on) => tick(group.id, on === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{group.name}</span>
                    {facts.length > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {facts.join(" · ")}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {groups.length > GROUPS_SHOWN && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="flex min-h-11 w-full items-center gap-3 border-t border-border text-xs font-semibold text-primary-ink transition-colors hover:text-primary-ink/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="min-w-0 flex-1 text-left">
              {tSettings("showAllGroups", { count: groups.length })}
            </span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
          </button>
        )}
      </section>

      <section className="space-y-2 border-t border-border pt-5">
        <SettingsControlRow
          htmlFor={`${ids}-receipts`}
          label={t("what.receiptsTitle")}
          description={t("what.receiptsBig")}
          control={
            <Switch
              id={`${ids}-receipts`}
              size="lg"
              checked={draft.includeReceipts}
              onCheckedChange={(on) => edit({ includeReceipts: on }, "chosen")}
            />
          }
        />
        <p className="text-xs text-pretty text-muted-foreground">
          {t("what.receiptsEncrypted")}
        </p>
        <p className="text-xs text-pretty text-muted-foreground">
          {t("what.receiptsRestore")}
        </p>
        <div aria-live="polite">
          {draft.includeReceipts && estimate && (
            <p className="text-xs font-medium text-pretty">
              {t("what.estimate", {
                size: formatBytes(estimate.bytes, numberLocale),
                count: ticked.length,
              })}
              {estimate.bytes >= BIG_RECEIPTS_BYTES && (
                <span className="block font-normal text-muted-foreground">
                  {t("what.estimateBig")}
                </span>
              )}
            </p>
          )}
        </div>
      </section>

      {keyFingerprint && (
        <p className="flex items-start gap-2 border-t border-border pt-5 font-mono text-xs text-muted-foreground">
          <KeyRound
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
            strokeWidth={2}
          />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {t("overview.keyId", { id: spaced(keyFingerprint) })}
          </span>
        </p>
      )}

      <div className="-mx-4 -mb-4 border-t border-border">
        <Link
          href={`/settings/backup/setup?step=where&replace=${encodeURIComponent(destination.id)}`}
          className={ROW}
        >
          <CloudUpload
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.9}
          />
          <span className="min-w-0 flex-1">{t("overview.changeWhere")}</span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground">
            {t("overview.change")}
            <ChevronRight aria-hidden="true" className="size-4" />
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setRotating(true)}
          className={`${ROW} border-t border-border`}
        >
          <KeyRound
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.9}
          />
          <span className="min-w-0 flex-1">
            {t("overview.rotate")}
            <span className="block text-xs font-normal text-muted-foreground">
              {t("overview.rotateHelp")}
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </button>
        <button
          type="button"
          onClick={() => setRemoving(true)}
          className={`${ROW} border-t border-border text-destructive`}
        >
          <Unplug
            aria-hidden="true"
            className="size-4 shrink-0"
            strokeWidth={1.9}
          />
          {t("overview.remove")}
        </button>
      </div>

      <ConfirmSheet
        open={rotating}
        onOpenChange={setRotating}
        title={t("rotate.title")}
        body={t("rotate.body")}
        confirmLabel={t("rotate.confirm")}
        cancelLabel={t("rotate.cancel")}
        onConfirm={startRotation}
      />

      <ConfirmSheet
        open={removing}
        onOpenChange={setRemoving}
        destructive
        title={t("remove.title", { provider })}
        body={t("remove.body", { provider })}
        confirmLabel={t("remove.confirm")}
        cancelLabel={t("remove.cancel")}
        onConfirm={stop}
      >
        <div className="space-y-3 text-xs">
          <div className="space-y-1">
            <h3 className="font-semibold">{t("remove.goneTitle")}</h3>
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              <li>{t("remove.goneConnection")}</li>
              <li>{t("remove.goneSchedule")}</li>
            </ul>
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold">{t("remove.staysTitle")}</h3>
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              <li>{t("remove.staysFiles", { provider })}</li>
              <li>{t("remove.staysKey")}</li>
            </ul>
          </div>
        </div>
      </ConfirmSheet>
    </div>
  );
}
