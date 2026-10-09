"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Cloud, FileLock, KeyRound, Lock, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  SettingsCard,
  SettingsRows,
} from "@/components/settings/settings-card";

/**
 * `/settings/backup` before anything is set up.
 *
 * Two sentences on what it does, three on why it is safe to try, one button.
 * The three reasons are the questions somebody asks before pointing a copy of
 * their group's money at a cloud account — can the server read it, can the
 * cloud, what happens if I lose the key — answered in the order they are asked.
 *
 * A person who owns no group has nothing to back up, so the button is off and
 * the sentence under it says why. Disabled and unexplained is a dead end; this
 * one tells them what to do about it.
 *
 * Under the button, a quiet way in for the person who arrives with a file and
 * no destination — a new server, a lost phone — and wants to open it.
 */

function Reason({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: string;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <span
        aria-hidden="true"
        className="flex size-7.5 shrink-0 items-center justify-center rounded-[10px] bg-wash-3"
      >
        <Icon className="size-4" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 space-y-0.5">
        <h3 className="text-sm font-medium text-pretty">{title}</h3>
        <p className="text-xs text-pretty text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

export function BackupEmptyState({
  startHref,
  ownsGroups,
}: {
  /** The wizard's first screen for this person: the key, or where, if they have one. */
  startHref: string;
  ownsGroups: boolean;
}) {
  const t = useTranslations("cloudBackup");

  return (
    <>
      <EmptyState
        icon={Cloud}
        title={t("empty.title")}
        description={t("empty.body")}
      />

      <SettingsCard
        title={t("empty.howTitle")}
        contentClassName="px-0 pt-2 pb-1"
      >
        <SettingsRows>
          <Reason icon={Lock} title={t("empty.lockedTitle")}>
            {t("empty.locked")}
          </Reason>
          <Reason icon={KeyRound} title={t("empty.keyTitle")}>
            {t("empty.key")}
          </Reason>
          <Reason icon={FileLock} title={t("empty.storedTitle")}>
            {t("empty.stored")}
          </Reason>
        </SettingsRows>
      </SettingsCard>

      <div className="flex shrink-0 flex-col gap-2">
        {ownsGroups ? (
          <Button asChild className="w-full">
            <Link href={startHref}>{t("empty.start")}</Link>
          </Button>
        ) : (
          <>
            <Button
              type="button"
              disabled
              aria-describedby="backup-no-owned"
              className="w-full"
            >
              {t("empty.start")}
            </Button>
            <p
              id="backup-no-owned"
              className="px-1.5 text-xs text-pretty text-muted-foreground"
            >
              {t("empty.noOwned")}
            </p>
          </>
        )}
        <Button asChild variant="link" className="w-full text-xs">
          <Link href="/settings/backup/restore">{t("empty.restoreLink")}</Link>
        </Button>
      </div>
    </>
  );
}
