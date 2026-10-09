"use client";

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Disclosure } from "@/components/settings/disclosure";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsControlRow } from "@/components/settings/settings-row";
import { Switch } from "@/components/ui/switch";
import { formatBytes } from "@/components/backup/format";
import { ProviderMark } from "@/components/backup/provider-mark";
import { useNumberLocale } from "@/i18n/format-context";
import type { DestinationView, RunView } from "@/modules/backup/service";
import { cn } from "@/lib/utils";
import { ManagePanel, type ManageGroup } from "./manage-panel";
import { RunArea } from "./run-area";
import { useDestinationDraft } from "./use-destination-draft";
import { hoursUntil, useWhen } from "./use-when";

/**
 * One backup destination: what it is, how it is going, and the one button.
 *
 * One card: the facts and the press, and under a hairline Manage, closed. The
 * two share one draft (`useDestinationDraft`), which is why one component draws
 * both — the pause switch up here and the chips in there are written by the
 * same queue, and what the facts say ("Weekly · keeps the last 20") follows the
 * controls the instant they move rather than when the server answers.
 *
 * ## Three facts, then a fourth
 *
 * Last backup, Next backup, Schedule — a label stacked over its value on a
 * phone, so a long French value wraps instead of squeezing its neighbour, and
 * three columns from `lg`. With receipts on there is a fourth, about how many
 * are still to go; the backend sends a few at a time, so after the first
 * backup there are usually some.
 *
 * "Last backup" is the last one that *wrote* something. A night with nothing
 * new is recorded as "no changes" and has no size, and printing "0 kB" as the
 * last backup would read as though the file were empty.
 */

function Fact({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-0.5", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-pretty [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

export function DestinationCard({
  destination,
  runs,
  groups,
  keyFingerprint,
  now,
}: {
  destination: DestinationView;
  /** The latest runs, newest first — History's rows. */
  runs: readonly RunView[];
  groups: readonly ManageGroup[];
  keyFingerprint: string | null;
  /** The server's clock for this render, as an ISO string. */
  now: string;
}) {
  const t = useTranslations("cloudBackup");
  const numberLocale = useNumberLocale();
  const when = useWhen(now);
  const switchId = useId();
  const { draft, edit } = useDestinationDraft(destination);

  const blocked = destination.status === "needs_reconnect";
  const paused = !blocked && draft.paused;

  // The name is what the connection was made with; whatever follows " · " is
  // the account, which is the part that tells two Drives apart.
  const [name = destination.label, ...rest] = destination.label.split(" · ");
  const account = rest.join(" · ");

  // The last run that wrote a file. `latestSuccess` may be a run that found
  // nothing new, which has no size to show.
  const written =
    runs.find((run) => run.status === "succeeded") ??
    (destination.latestSuccess?.status === "succeeded"
      ? destination.latestSuccess
      : null);
  const lastAt = written
    ? (written.finishedAt ?? written.startedAt)
    : destination.lastSuccessAt;
  const last = written
    ? t("overview.lastValue", {
        when: when.past(lastAt ?? written.startedAt),
        groups: t("overview.groups", { count: written.groupCount }),
        size: formatBytes(written.bytes, numberLocale),
      })
    : lastAt
      ? when.past(lastAt)
      : "—";

  const next = blocked
    ? t("overview.nextBlocked")
    : paused
      ? t("overview.nextPaused")
      : destination.consecutiveFailures > 0
        ? t("overview.nextRetry", {
            hours: hoursUntil(destination.nextRunAt, now),
          })
        : when.ahead(destination.nextRunAt);

  // Receipts: only once there is a finished run to say how it went, and not in
  // the minutes after the switch is turned on, when a run is due and the last
  // one's "all uploaded" predates the receipts being asked for.
  const receiptsRun = destination.latestSuccess;
  const due =
    destination.status === "active" &&
    destination.nextRunAt.getTime() <= new Date(now).getTime();
  const pending = receiptsRun?.receiptsPending ?? 0;
  const receiptsFact =
    destination.includeReceipts && draft.includeReceipts && receiptsRun
      ? pending > 0
        ? {
            // Only what the last run recorded: how many were left. How many
            // have gone up is not stored, so it is not said.
            value: t("overview.receiptsPending", { pending }),
            help: t("overview.receiptsHelp"),
          }
        : due
          ? null
          : { value: t("overview.receiptsDone"), help: null }
      : null;

  return (
    <SettingsCard contentClassName="px-0 pt-0 pb-0">
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          <ProviderMark provider={destination.provider} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="font-heading text-base font-semibold">{name}</h2>
              {paused && (
                <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-wash-3 px-2 text-2xs font-semibold text-muted-foreground">
                  {t("overview.pausedPill")}
                </span>
              )}
            </div>
            {account && (
              <p className="truncate text-xs text-muted-foreground">
                {account}
              </p>
            )}
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-3 lg:grid-cols-3">
          <Fact label={t("overview.last")}>{last}</Fact>
          <Fact label={t("overview.next")}>{next}</Fact>
          <Fact label={t("overview.scheduleLabel")}>
            {t("overview.scheduleValue", {
              schedule: t(`schedule.${draft.frequency}`),
              count: draft.keepLast,
            })}
          </Fact>
          {receiptsFact && (
            <Fact label={t("overview.receipts")} className="lg:col-span-3">
              {receiptsFact.value}
            </Fact>
          )}
        </dl>
        {receiptsFact?.help && (
          <p className="-mt-2 text-xs text-pretty text-muted-foreground">
            {receiptsFact.help}
          </p>
        )}

        <div className="border-t border-border pt-4">
          {/* Drawn while the connection is waiting to be reconnected, but not
              to be pressed: the server pauses only a destination that is
              running, so a press now would leave the switch saying "paused" for
              a destination the server still has waiting. The banner above says
              what to do instead. */}
          <SettingsControlRow
            htmlFor={switchId}
            label={t("overview.auto")}
            description={
              draft.paused
                ? t("overview.autoOff")
                : draft.frequency === "daily"
                  ? t("overview.autoDaily")
                  : t("overview.autoWeekly")
            }
            control={
              <Switch
                id={switchId}
                size="lg"
                checked={!draft.paused}
                disabled={blocked}
                onCheckedChange={(on) => edit({ paused: !on }, "chosen")}
              />
            }
          />
        </div>

        <RunArea destination={destination} />
      </div>

      <Disclosure label={t("overview.manage")}>
        <ManagePanel
          destination={destination}
          groups={groups}
          draft={draft}
          edit={edit}
          keyFingerprint={keyFingerprint}
        />
      </Disclosure>
    </SettingsCard>
  );
}
