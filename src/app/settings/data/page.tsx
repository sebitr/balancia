import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Upload } from "lucide-react";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { SettingsCard } from "@/components/settings/settings-card";
import { ExportPanel } from "@/components/settings/export-panel";
import { getDateFormatter } from "@/i18n/preferences";
import { getCurrentUser } from "@/lib/security/actor";
import { listGroupsForUser } from "@/modules/groups/service";
import { listRecentImportRunsForUser } from "@/modules/imports/service";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("data") };
}

/**
 * Getting data out of Balancia, and getting somebody else's data in.
 *
 * Both are per-group operations reached from an account-level screen, which is
 * why each starts by naming a group. That is the honest shape: expenses belong
 * to a group, there is no such thing as exporting "the account", and a button
 * that pretended otherwise would have to pick a group anyway.
 */
export default async function DataSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const t = await getTranslations("userSettings");
  const dates = await getDateFormatter();

  const [groups, runs] = await Promise.all([
    listGroupsForUser(user.userId),
    listRecentImportRunsForUser(user.userId),
  ]);

  // Importing writes expenses, so it is offered only where this account is
  // allowed to write them. The wizard authorizes again on arrival.
  const writable = groups.filter((group) => group.archivedAt === null);

  return (
    <SettingsScreen
      title={t("data")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
      <SettingsCard title={t("exportTitle")} description={t("exportHelp")}>
        <ExportPanel
          groups={groups.map((group) => ({ id: group.id, name: group.name }))}
        />
      </SettingsCard>

      <SettingsCard title={t("importTitle")} description={t("importHelp")}>
        {writable.length > 0 ? (
          <Link
            href={`/groups/${writable[0].id}/import`}
            className="tap-target flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-input text-sm font-semibold transition-colors hover:bg-wash-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Upload aria-hidden="true" className="size-4" />
            {t("importAction")}
          </Link>
        ) : (
          <p className="text-xs text-muted-foreground">{t("noGroups")}</p>
        )}

        {runs.length > 0 && (
          <ul className="mt-3.5 -mb-1 space-y-2.5 border-t border-border pt-3.5">
            {runs.map((run) => (
              <li key={run.id} className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">
                    {run.fileName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t("importedInto", {
                      count: run.rowsImported,
                      group: run.groupName,
                    })}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-xs font-medium",
                    run.status === "completed" && "text-positive-ink",
                    run.status === "failed" && "text-destructive",
                    run.status !== "completed" &&
                      run.status !== "failed" &&
                      "text-muted-foreground",
                  )}
                >
                  {t(`importStatus.${run.status}`)}
                  {" · "}
                  {dates.at(run.completedAt ?? run.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </SettingsScreen>
  );
}
