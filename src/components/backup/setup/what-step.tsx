"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleAlert, Users } from "lucide-react";
import { formatBytes } from "@/components/backup/format";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsControlRow } from "@/components/settings/settings-row";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Switch } from "@/components/ui/switch";
import { useDateFormatter, useNumberLocale } from "@/i18n/format-context";
import { estimateReceiptsAction } from "@/modules/backup/actions";
import { KEEP_CHOICES, type Choices } from "./draft";
import { StepFooter, type FooterAction } from "./fields";
import type { SetupGroup } from "./types";

/** How many groups are listed before "Show all". */
const SHOWN = 5;
/** A receipt backup this big is worth a quiet line about cloud plans. */
const BIG = 1_000_000_000;
/** How long the ticks have to stop moving before the estimate asks again. */
const QUIET = 300;

export interface FinishError {
  readonly sentence: string;
  readonly hint: string | null;
}

/**
 * Step 4: which groups, how often, how many to keep, and whether receipts go.
 *
 * Everything here is a draft until "Start backing up" is pressed, and the
 * button runs the first backup. Groups are only the ones the person owns — a
 * member cannot back up somebody else's — and all of them start ticked: the
 * likely answer is "all of it", and a person who wants fewer is one tap away.
 *
 * Receipts are their own card and off, because they are the one thing here
 * that can cost money. The cost is spelled out beside the switch, always, and
 * once it is on a live figure says how much it would be.
 */
export function WhatStep({
  ownedGroups,
  choices,
  onChoices,
  error,
  finishing,
  onFinish,
  secondary,
}: {
  ownedGroups: readonly SetupGroup[];
  choices: Choices;
  onChoices: (patch: Partial<Choices>) => void;
  /** A refusal of the finish, worded; the draft stays as it was. */
  error: FinishError | null;
  finishing: boolean;
  onFinish: () => void;
  secondary: FooterAction;
}) {
  const t = useTranslations("cloudBackup");
  const tSettings = useTranslations("userSettings");
  const dates = useDateFormatter();
  const numbers = useNumberLocale();
  const receiptsId = useId();
  const keepId = useId();

  const [showAll, setShowAll] = useState(false);
  const [estimate, setEstimate] = useState<{
    bytes: number;
    groups: number;
  } | null>(null);

  const excluded = new Set(choices.excludedGroupIds);
  const ticked = ownedGroups.filter((group) => !excluded.has(group.id));
  const noOwned = ownedGroups.length === 0;
  const visible = showAll ? ownedGroups : ownedGroups.slice(0, SHOWN);

  const toggle = (id: string) => {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChoices({ excludedGroupIds: [...next] });
  };

  // The figure follows the ticks. Waiting for them to settle keeps a person
  // running down a list from sending a request per row, and the `current`
  // flag throws away an answer to a question that is no longer the one asked.
  const excludedKey = choices.excludedGroupIds.join(",");
  const groupCount = ticked.length;
  useEffect(() => {
    if (!choices.includeReceipts || groupCount === 0) return;
    let current = true;
    const timer = setTimeout(() => {
      estimateReceiptsAction(excludedKey === "" ? [] : excludedKey.split(","))
        .then((result) => {
          if (current && result.ok && result.data) {
            setEstimate({ bytes: result.data.bytes, groups: groupCount });
          }
        })
        .catch(() => undefined);
    }, QUIET);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [choices.includeReceipts, excludedKey, groupCount]);

  const keeps = (KEEP_CHOICES as readonly number[]).includes(choices.keepLast)
    ? [...KEEP_CHOICES]
    : [...KEEP_CHOICES, choices.keepLast].sort((a, b) => a - b);

  const showEstimate =
    choices.includeReceipts && groupCount > 0 && estimate !== null;

  return (
    <>
      <h2 className="px-1.5 font-heading text-base font-semibold">
        {t("what.title")}
      </h2>

      {noOwned ? (
        <EmptyState
          icon={Users}
          title={t("what.noOwnedTitle")}
          description={t("empty.noOwned")}
        />
      ) : (
        <>
          <SettingsCard
            title={t("what.groupsTitle")}
            description={t("what.groupsHelp")}
          >
            <div className="space-y-2">
              <p
                aria-live="polite"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("what.count", {
                  count: ticked.length,
                  total: ownedGroups.length,
                })}
              </p>
              <ul className="[&>li+li]:relative [&>li+li]:before:pointer-events-none [&>li+li]:before:absolute [&>li+li]:before:inset-x-0 [&>li+li]:before:top-0 [&>li+li]:before:ml-7 [&>li+li]:before:border-t [&>li+li]:before:border-border">
                {visible.map((group) => (
                  <li key={group.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 py-2.5">
                      <Checkbox
                        checked={!excluded.has(group.id)}
                        onCheckedChange={() => toggle(group.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {group.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t("what.members", { count: group.participantCount })}
                          {group.lastActivityAt && (
                            <>
                              {" · "}
                              {t("what.changed", {
                                date: dates.at(group.lastActivityAt),
                              })}
                            </>
                          )}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {!showAll && ownedGroups.length > SHOWN && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowAll(true)}
                  className="w-full"
                >
                  {tSettings("showAllGroups", { count: ownedGroups.length })}
                </Button>
              )}
              <p className="pt-1 text-xs text-pretty text-muted-foreground">
                {t("what.ownersOnly")}
              </p>
            </div>
          </SettingsCard>

          <SettingsCard title={t("what.scheduleTitle")}>
            <div className="space-y-3.5">
              <div
                role="group"
                aria-label={t("what.scheduleTitle")}
                className="flex gap-2"
              >
                <Chip
                  selected={choices.frequency === "daily"}
                  label={t("schedule.daily")}
                  onClick={() => onChoices({ frequency: "daily" })}
                />
                <Chip
                  selected={choices.frequency === "weekly"}
                  label={t("schedule.weekly")}
                  onClick={() => onChoices({ frequency: "weekly" })}
                />
              </div>
              <div className="space-y-1.5">
                <p id={keepId} className="text-xs font-semibold">
                  {t("what.keepLabel")}
                </p>
                <div
                  role="group"
                  aria-labelledby={keepId}
                  className="flex flex-wrap gap-2"
                >
                  {keeps.map((count) => (
                    <Chip
                      key={count}
                      selected={choices.keepLast === count}
                      label={String(count)}
                      onClick={() => onChoices({ keepLast: count })}
                    />
                  ))}
                </div>
                <p className="text-xs text-pretty text-muted-foreground">
                  {t("what.keepHelp")}
                </p>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard>
            <SettingsControlRow
              label={t("what.receiptsTitle")}
              description={
                choices.includeReceipts ? undefined : t("what.receiptsOff")
              }
              htmlFor={receiptsId}
              control={
                <Switch
                  id={receiptsId}
                  size="lg"
                  checked={choices.includeReceipts}
                  onCheckedChange={(includeReceipts) =>
                    onChoices({ includeReceipts })
                  }
                />
              }
            />
            {/* The cost sits beside the switch whatever its position: a
                warning that appears after the decision is no warning. */}
            <div className="mt-3 space-y-1.5 text-xs text-pretty text-muted-foreground">
              <p>{t("what.receiptsBig")}</p>
              <p>{t("what.receiptsEncrypted")}</p>
              <p>{t("what.receiptsRestore")}</p>
            </div>
            <div aria-live="polite" className="empty:hidden">
              {showEstimate && (
                <div className="mt-3 space-y-0.5 border-t border-border pt-3">
                  <p className="text-sm font-medium">
                    {t("what.estimate", {
                      size: formatBytes(estimate.bytes, numbers),
                      count: estimate.groups,
                    })}
                  </p>
                  {estimate.bytes > BIG && (
                    <p className="text-xs text-muted-foreground">
                      {t("what.estimateBig")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </SettingsCard>
        </>
      )}

      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>
            {error.sentence}
            {error.hint && <> {error.hint}</>}
          </AlertDescription>
        </Alert>
      )}

      <StepFooter
        secondary={secondary}
        primary={{
          label: t("what.finish"),
          onClick: onFinish,
          disabled: noOwned || groupCount === 0,
          pending: finishing,
        }}
        hint={!noOwned && groupCount === 0 ? t("what.none") : undefined}
        note={t("what.finishHelp")}
      />
    </>
  );
}
