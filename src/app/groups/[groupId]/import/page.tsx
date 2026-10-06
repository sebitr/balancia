import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDateFormatter } from "@/i18n/preferences";
import { Badge } from "@/components/ui/badge";
import { ImportWizard } from "@/components/imports/import-wizard";
import { PageHeader } from "@/components/ui/page-header";
import { requireGroupAccess } from "@/lib/actions";
import { listImportRuns } from "@/modules/imports/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("importPage");
  return { title: t("title") };
}

export default async function ImportPage({
  params,
}: PageProps<"/groups/[groupId]/import">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  if (!access.permissions.importData) {
    notFound();
  }

  const runs = await listImportRuns(access.groupId);
  const t = await getTranslations("importPage");
  const tCommon = await getTranslations("common");
  const dates = await getDateFormatter();

  return (
    <div className="space-y-6">
      <div>
        {/* The group, not its settings: two of the three ways in here are the
            empty overview and the data screen of the user's own settings, and
            the group is the one place all three readers came through. */}
        <PageHeader
          title={t("title")}
          back={{ href: `/groups/${groupId}`, label: tCommon("backToGroup") }}
        />
        <p className="pl-10.5 text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      <ImportWizard groupId={access.groupId} />

      {runs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("previous")}
          </h2>
          <ul className="divide-y rounded-lg border">
            {runs.map((run) => (
              <li
                key={run.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {run.fileName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {dates.at(run.createdAt, {
                      time: "short",
                      // The group's clock, as in its activity feed, rather
                      // than the server's.
                      timeZone: access.group.timezone,
                    })}{" "}
                    ·{" "}
                    {t("runSummary", {
                      imported: run.rowsImported,
                      skipped: run.rowsSkipped,
                    })}
                    {run.rowsFailed > 0 &&
                      t("runFailed", { failed: run.rowsFailed })}
                  </span>
                </span>
                {/* One word per status the column can hold, and no fallback
                    to the stored value: four of the six used to reach the
                    page as `ready` or `parsed`, in English, in any language.
                    `import-status.test.ts` holds the catalogue to the enum. */}
                <Badge
                  variant={run.status === "completed" ? "secondary" : "outline"}
                >
                  {t(`status.${run.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
