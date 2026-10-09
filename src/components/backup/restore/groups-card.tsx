"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDateFormatter } from "@/i18n/format-context";
import type { RestoredBackup, RestoredGroup } from "@/modules/backup/restore";
import { saveTextFile } from "./save-file";

/** How many groups are listed before "Show more". */
const FIRST = 5;

/**
 * What was inside the backup: the groups, each with a way to take it out.
 *
 * The way out is a JSON file, the same one Export writes, which the group's
 * own Import accepts. There is deliberately no "Import into a new group" here:
 * making a group is a different act from reading a backup, and a screen that
 * has just decrypted the person's data should hand it back and stop.
 *
 * A backup of no groups is a real one (somebody who stopped owning any), so it
 * gets its heading and its line and no list.
 *
 * Focus moves to the heading on arrival: the press that opened the backup was
 * in a form that has just changed under it, and the result is what a screen
 * reader should say next.
 */
export function GroupsCard({ backup }: { backup: RestoredBackup }) {
  const t = useTranslations("cloudBackup");
  const dates = useDateFormatter();
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const made = new Date(backup.createdAt);
  const when = Number.isNaN(made.getTime())
    ? null
    : dates.at(made, { time: "short" });
  const shown = showAll ? backup.groups : backup.groups.slice(0, FIRST);
  const hidden = backup.groups.length - shown.length;

  return (
    <section
      aria-labelledby={headingId}
      className="shrink-0 scroll-mt-16 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
    >
      <div className="space-y-1 px-4 pt-4">
        <h2
          id={headingId}
          ref={heading}
          tabIndex={-1}
          className="font-heading text-base font-semibold outline-none"
        >
          {t("restore.foundTitle", { count: backup.groups.length })}
        </h2>
        {when && backup.instance !== "" && (
          <p className="text-xs text-pretty break-words text-muted-foreground">
            {t("restore.foundHelp", { when, instance: backup.instance })}
          </p>
        )}
      </div>

      {backup.groups.length > 0 && (
        <>
          <ul className="mt-3 border-t border-border">
            {shown.map((group) => (
              <GroupRow key={group.id} group={group} />
            ))}
          </ul>
          {hidden > 0 && (
            <div className="border-t border-border px-4 py-2">
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setShowAll(true)}
              >
                {t("restore.showMore", { count: hidden })}
              </Button>
            </div>
          )}
          <p className="border-t border-border px-4 py-3.5 text-xs text-pretty text-muted-foreground">
            {t("restore.importHint")}
          </p>
        </>
      )}
    </section>
  );
}

function GroupRow({ group }: { group: RestoredGroup }) {
  const t = useTranslations("cloudBackup");
  const nameId = useId();

  return (
    <li className="flex flex-col gap-2.5 px-4 py-3.5 not-first:border-t not-first:border-border lg:flex-row lg:items-center lg:justify-between lg:gap-4">
      <div className="min-w-0">
        <p id={nameId} className="text-sm font-medium break-words">
          {group.name}
        </p>
        <p className="text-xs text-muted-foreground">
          <span>{t("restore.people", { count: group.participantCount })}</span>
          <span aria-hidden="true"> · </span>
          <span>
            {t("restore.entries", {
              count: group.expenseCount + group.settlementCount,
            })}
          </span>
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        // Every row says the same thing, so the group's name is what tells a
        // screen reader which one this is.
        aria-describedby={nameId}
        className="w-full lg:w-auto lg:shrink-0"
        onClick={() => saveTextFile(group.fileName, group.json)}
      >
        <Download aria-hidden="true" />
        {t("restore.downloadJson")}
      </Button>
    </li>
  );
}
