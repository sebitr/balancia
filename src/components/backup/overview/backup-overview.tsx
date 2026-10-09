"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArchiveRestore } from "lucide-react";
import {
  SettingsGroup,
  SettingsRows,
} from "@/components/settings/settings-card";
import { SettingsLinkRow } from "@/components/settings/settings-row";
import type { DestinationView, RunView } from "@/modules/backup/service";
import { BackupBanner } from "./banner";
import { DestinationCard } from "./destination-card";
import type { ManageGroup } from "./manage-panel";
import { BackupHistory } from "./history";

/**
 * The overview of one destination, top to bottom.
 *
 * A banner when something needs saying, the card and its Manage, the history,
 * and the way into Restore. It is one component rather than four siblings on
 * the page because the banner's "See details" opens a row of the history, and
 * somebody has to hold which row is open.
 *
 * A fragment: its cards are the screen's own flex children, spaced by the
 * screen like every other settings page's.
 */
export function BackupOverview({
  destination,
  runs,
  groups,
  keyFingerprint,
  now,
}: {
  destination: DestinationView;
  /** The latest runs, newest first. */
  runs: readonly RunView[];
  groups: readonly ManageGroup[];
  keyFingerprint: string | null;
  now: string;
}) {
  const t = useTranslations("cloudBackup");
  const [openId, setOpenId] = useState<string | null>(null);

  const failedRun =
    runs.find((run) => run.status === "failed") ??
    (destination.latestRun?.status === "failed" ? destination.latestRun : null);

  const showDetails = () => {
    if (!failedRun) return;
    setOpenId(failedRun.id);
    // After the row has opened and, on a phone, been let out from behind "Show
    // more": bring it into view, and put the keyboard where the eye now is.
    requestAnimationFrame(() => {
      document
        .getElementById(`run-${failedRun.id}`)
        ?.scrollIntoView?.({ block: "center" });
      document.getElementById(`run-${failedRun.id}-toggle`)?.focus();
    });
  };

  return (
    <>
      <BackupBanner
        destination={destination}
        failedRun={failedRun}
        onDetails={showDetails}
      />

      <DestinationCard
        destination={destination}
        runs={runs}
        groups={groups}
        keyFingerprint={keyFingerprint}
        now={now}
      />

      <BackupHistory
        runs={runs}
        provider={destination.provider}
        now={now}
        openId={openId}
        onOpenChange={setOpenId}
      />

      <SettingsGroup>
        <SettingsRows>
          <SettingsLinkRow
            href="/settings/backup/restore"
            icon={ArchiveRestore}
            label={t("overview.restore")}
            description={t("overview.restoreHelp")}
          />
        </SettingsRows>
      </SettingsGroup>
    </>
  );
}
