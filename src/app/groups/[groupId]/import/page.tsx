import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { ImportWizard } from "@/components/imports/import-wizard";
import { requireGroupAccess } from "@/lib/actions";
import { listImportRuns } from "@/modules/imports/service";

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
  const format = await getFormatter();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
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
                    {format.dateTime(run.createdAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
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
                <Badge
                  variant={run.status === "completed" ? "secondary" : "outline"}
                >
                  {t.has(`status.${run.status}` as "status.completed")
                    ? t(`status.${run.status}` as "status.completed")
                    : run.status}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
