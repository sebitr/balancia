"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  commitImportAction,
  stageImportAction,
} from "@/modules/imports/actions";
import type { ImportPreview, ImportReport } from "@/modules/imports/service";

const CREATE_PARTICIPANT = "__create__";

/**
 * Splitwise import wizard: upload → preview → map people → import → report.
 *
 * The preview step is where the user sees exactly what will happen, including
 * rows that will be skipped because they were already imported. Committing is
 * safe to retry: nothing already imported is written twice.
 */
export function ImportWizard({ groupId }: { groupId: string }) {
  const router = useRouter();
  const t = useTranslations("importWizard");
  /** Bolds the figure inside a count message. */
  const bold = (chunks: React.ReactNode) => <strong>{chunks}</strong>;
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onUpload = async (formData: FormData) => {
    setError(null);
    setReport(null);
    setPending(true);
    try {
      const result = await stageImportAction(groupId, formData);
      if (!result.ok || !result.data) {
        setError(result.error ?? t("readFailed"));
        return;
      }
      setPreview(result.data);
      // Start from the suggested matches; unmatched names default to "create".
      const initial: Record<string, string> = {};
      for (const name of result.data.sourceParticipants) {
        initial[name] =
          result.data.suggestedMapping[name] ?? CREATE_PARTICIPANT;
      }
      setMapping(initial);
    } finally {
      setPending(false);
    }
  };

  const onCommit = async () => {
    if (!preview) return;
    setError(null);
    setPending(true);
    try {
      const result = await commitImportAction(
        groupId,
        preview.importRunId,
        mapping,
      );
      if (!result.ok || !result.data) {
        setError(result.error ?? t("commitFailed"));
        return;
      }
      setReport(result.data);
      toast.success(t("finished"));
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  if (report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 aria-hidden="true" className="size-5 text-positive" />
            {t("completeTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="space-y-1">
            <li>{t.rich("imported", { b: () => bold(report.imported) })}</li>
            <li>{t.rich("skipped", { b: () => bold(report.skipped) })}</li>
            {report.failed > 0 && (
              <li className="text-destructive">
                {t.rich("failed", { b: () => bold(report.failed) })}
              </li>
            )}
            {report.participantsCreated > 0 && (
              <li>
                {t.rich("peopleAdded", {
                  count: report.participantsCreated,
                  b: () => bold(report.participantsCreated),
                })}
              </li>
            )}
          </ul>
          <Button
            variant="outline"
            onClick={() => {
              setPreview(null);
              setReport(null);
            }}
          >
            {t("another")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (preview) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("previewTitle", { fileName: preview.fileName })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                {t("expenseCount", { count: preview.expenseCount })}
              </Badge>
              <Badge variant="secondary">
                {t("settlementCount", { count: preview.settlementCount })}
              </Badge>
              {preview.duplicateCount > 0 && (
                <Badge variant="outline">
                  {t("duplicateCount", { count: preview.duplicateCount })}
                </Badge>
              )}
              {preview.currencies.map((currency) => (
                <Badge key={currency} variant="outline">
                  {currency}
                </Badge>
              ))}
            </div>

            {preview.warnings.length > 0 && (
              <Alert>
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>
                  {t("warningsTitle", { count: preview.warnings.length })}
                </AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 space-y-1">
                    {preview.warnings.slice(0, 8).map((warning, index) => (
                      <li key={index} className="text-xs">
                        {warning.rowNumber
                          ? t("warningRow", { row: warning.rowNumber })
                          : ""}
                        {warning.message}
                        {warning.detail && ` (${warning.detail})`}
                      </li>
                    ))}
                    {preview.warnings.length > 8 && (
                      <li className="text-xs">
                        {t("andMore", { count: preview.warnings.length - 8 })}
                      </li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("matchTitle")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("matchHelp")}</p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {preview.sourceParticipants.map((sourceName) => (
                <li
                  key={sourceName}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <Label htmlFor={`map-${sourceName}`} className="font-normal">
                    {sourceName}
                  </Label>
                  <select
                    id={`map-${sourceName}`}
                    value={mapping[sourceName] ?? CREATE_PARTICIPANT}
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        [sourceName]: event.target.value,
                      }))
                    }
                    className="h-9 min-w-48 rounded-md border border-input bg-background px-3 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
                  >
                    <option value={CREATE_PARTICIPANT}>{t("addAsNew")}</option>
                    {preview.groupParticipants.map((participant) => (
                      <option key={participant.id} value={participant.id}>
                        {participant.displayName}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-3">
          <Button onClick={() => void onCommit()} disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {t("importRows", {
              count: preview.rowsTotal - preview.duplicateCount,
            })}
          </Button>
          <Button
            variant="outline"
            onClick={() => setPreview(null)}
            disabled={pending}
          >
            {t("differentFile")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form action={onUpload} className="space-y-4 rounded-lg border p-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="import-file">{t("fileLabel")}</Label>
          <input
            id="import-file"
            name="file"
            type="file"
            accept=".csv,.json"
            required
            className="block w-full rounded-md border border-input text-sm file:mr-3 file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:text-secondary-foreground"
          />
          <p className="text-xs text-muted-foreground">{t("fileHelp")}</p>
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          {t("read")}
        </Button>
      </form>

      <ExportInstructions />
    </div>
  );
}

/**
 * Getting the file out of Splitwise is the step people get stuck on, so the
 * instructions live next to the upload rather than in the docs. Collapsed by
 * default: anyone who already has the export should not have to scroll past it.
 */
function ExportInstructions() {
  return (
    <details className="group rounded-lg border">
      {/* Safari keeps its own disclosure triangle unless it is hidden explicitly. */}
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        How do I export from Splitwise?
      </summary>

      <div className="space-y-4 border-t px-4 py-3 text-sm">
        <section className="space-y-2">
          <h3 className="font-medium">One group, as a spreadsheet (CSV)</h3>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>
              Sign in at{" "}
              <a
                href="https://secure.splitwise.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground underline underline-offset-4"
              >
                secure.splitwise.com
              </a>{" "}
              — the export is only offered on the web, not in the mobile apps.
            </li>
            <li>Open the group you want to bring across.</li>
            <li>
              In the panel on the right, choose{" "}
              <strong className="font-medium text-foreground">
                Export as spreadsheet
              </strong>{" "}
              and pick CSV.
            </li>
            <li>Upload the downloaded file above.</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Repeat per group: a CSV covers one Splitwise group, and each one
            should be imported into its own Balancia group.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Your whole account, as JSON</h3>
          <p className="text-muted-foreground">
            In Splitwise&rsquo;s account settings, request a copy of your data.
            Splitwise emails you an archive; upload the JSON file holding your
            expenses. It records who paid and who owed on every expense, so
            multiple payers and uneven splits come across exactly.
          </p>
        </section>

        <p className="text-xs text-muted-foreground">
          Either way, nothing is imported until you have seen the preview, and
          re-uploading the same file never creates duplicates.
        </p>
      </div>
    </details>
  );
}
