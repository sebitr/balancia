"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { SettingsCard } from "@/components/settings/settings-card";
import { formatBytes } from "@/components/backup/format";
import { StatusMark } from "@/components/backup/status-mark";
import { useNumberLocale } from "@/i18n/format-context";
import {
  PROVIDER_NAMES,
  type BackupProvider,
} from "@/modules/backup/providers";
import type { RunView } from "@/modules/backup/service";
import { cn } from "@/lib/utils";
import { errorCopy } from "@/components/backup/error-copy";
import { useWhen } from "./use-when";

/**
 * The last ten runs of one destination, each with how it ended.
 *
 * A row is a time, one line of what happened, and a status that is an icon and
 * a word. Most rows are inert text. A failed one is a button, because its one
 * line ("The account is not allowed to write there.") is the answer to "what
 * happened" and the rest of the answer — what to do, and the provider's own
 * words — is the reason someone opened the list.
 *
 * ## Six on a phone, all of them from `lg`
 *
 * Ten rows of two lines each is most of a phone screen of history nobody reads
 * past the third. So below `lg` the first six show and "Show 4 more" opens the
 * rest; from `lg`, where there is room, all ten are drawn and the button is not.
 * That is done in CSS rather than by asking the width, so the server's render
 * and the first client render agree and nothing flickers into place.
 *
 * ## Which row is open
 *
 * The banner's "See details" opens a row from outside, so the open row is the
 * caller's to hold. A row hidden behind "Show more" that is opened from outside
 * is shown: opening something nobody can see helps nobody.
 */

const PHONE_ROWS = 6;

export function BackupHistory({
  runs,
  provider,
  now,
  openId,
  onOpenChange,
}: {
  runs: readonly RunView[];
  provider: BackupProvider;
  now: string;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
}) {
  const t = useTranslations("cloudBackup");
  const numberLocale = useNumberLocale();
  const when = useWhen(now);
  const providerName = PROVIDER_NAMES[provider];
  const [expanded, setExpanded] = useState(false);

  if (runs.length === 0) return null;

  const openIndex = runs.findIndex((run) => run.id === openId);
  const showAll = expanded || openIndex >= PHONE_ROWS;
  const hidden = runs.length - PHONE_ROWS;

  const detailOf = (run: RunView): string => {
    switch (run.status) {
      case "succeeded":
        return `${t("overview.groups", { count: run.groupCount })} · ${formatBytes(run.bytes, numberLocale)}`;
      case "unchanged":
        return t("overview.skippedReason");
      case "failed":
        return errorCopy(t, run.errorCode, providerName).sentence;
      case "running":
        return t("overview.runningLabel");
    }
  };

  return (
    <SettingsCard
      title={t("overview.history")}
      contentClassName="px-0 pt-1.5 pb-0"
    >
      <ul>
        {runs.map((run, index) => {
          const isOpen = run.id === openId;
          const failed = run.status === "failed";
          const copy = failed
            ? errorCopy(t, run.errorCode, providerName)
            : null;
          const panel = `run-${run.id}-detail`;

          const body = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {when.past(run.startedAt)}
                </span>
                <span className="block text-xs text-pretty text-muted-foreground">
                  {detailOf(run)}
                </span>
              </span>
              <StatusMark status={run.status} />
              {failed && (
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
                    isOpen && "rotate-90",
                  )}
                />
              )}
            </>
          );

          return (
            <li
              key={run.id}
              id={`run-${run.id}`}
              className={cn(
                "relative before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:border-t before:border-border first:before:hidden",
                // Only the phone hides rows; from `lg` they all show.
                index >= PHONE_ROWS && !showAll && "max-lg:hidden",
              )}
            >
              {failed ? (
                <button
                  type="button"
                  id={`run-${run.id}-toggle`}
                  aria-expanded={isOpen}
                  aria-controls={panel}
                  onClick={() => onOpenChange(isOpen ? null : run.id)}
                  className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-wash-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:-outline-offset-2 focus-visible:outline-none"
                >
                  {body}
                </button>
              ) : (
                <div className="flex min-h-11 items-center gap-3 px-4 py-3">
                  {body}
                </div>
              )}
              {failed && isOpen && copy && (
                <div id={panel} className="space-y-2 px-4 pb-4">
                  <h3 className="text-xs font-semibold">
                    {t("overview.detailTitle")}
                  </h3>
                  <p className="text-sm text-pretty">
                    {copy.sentence}
                    {copy.hint && (
                      <span className="block text-muted-foreground">
                        {copy.hint}
                      </span>
                    )}
                  </p>
                  {run.errorDetail && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        {t("overview.providerWords")}
                      </p>
                      <code className="block rounded-lg bg-wash-1 px-3 py-2 font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
                        {run.errorDetail}
                      </code>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {hidden > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex min-h-11 w-full items-center border-t border-border px-4 py-3 text-xs font-semibold text-primary-ink transition-colors hover:bg-wash-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:-outline-offset-2 focus-visible:outline-none lg:hidden"
        >
          {t("overview.historyMore", { count: hidden })}
        </button>
      )}
    </SettingsCard>
  );
}
