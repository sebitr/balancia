"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, TriangleAlert, Upload } from "lucide-react";
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
        setError(result.error ?? "That file could not be read.");
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
        setError(result.error ?? "The import could not be completed.");
        return;
      }
      setReport(result.data);
      toast.success("Import finished");
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
            Import complete
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="space-y-1">
            <li>
              <strong>{report.imported}</strong> imported
            </li>
            <li>
              <strong>{report.skipped}</strong> skipped as already present
            </li>
            {report.failed > 0 && (
              <li className="text-destructive">
                <strong>{report.failed}</strong> could not be imported
              </li>
            )}
            {report.participantsCreated > 0 && (
              <li>
                <strong>{report.participantsCreated}</strong> new{" "}
                {report.participantsCreated === 1 ? "person" : "people"} added
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
            Import another file
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
              Preview: {preview.fileName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{preview.expenseCount} expenses</Badge>
              <Badge variant="secondary">
                {preview.settlementCount} payments
              </Badge>
              {preview.duplicateCount > 0 && (
                <Badge variant="outline">
                  {preview.duplicateCount} already imported
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
                  {preview.warnings.length} row
                  {preview.warnings.length === 1 ? "" : "s"} will be skipped
                </AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 space-y-1">
                    {preview.warnings.slice(0, 8).map((warning, index) => (
                      <li key={index} className="text-xs">
                        {warning.rowNumber ? `Row ${warning.rowNumber}: ` : ""}
                        {warning.message}
                        {warning.detail && ` (${warning.detail})`}
                      </li>
                    ))}
                    {preview.warnings.length > 8 && (
                      <li className="text-xs">
                        …and {preview.warnings.length - 8} more.
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
            <CardTitle className="text-base">Match the people</CardTitle>
            <p className="text-sm text-muted-foreground">
              Connect each name from the export to someone in this group, or add
              them as a new person.
            </p>
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
                    className="h-9 min-w-48 rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <option value={CREATE_PARTICIPANT}>
                      Add as a new person
                    </option>
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
            Import {preview.rowsTotal - preview.duplicateCount} rows
          </Button>
          <Button
            variant="outline"
            onClick={() => setPreview(null)}
            disabled={pending}
          >
            Choose a different file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={onUpload} className="space-y-4 rounded-lg border p-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="import-file">Splitwise export</Label>
        <input
          id="import-file"
          name="file"
          type="file"
          accept=".csv,.json"
          required
          className="block w-full rounded-md border border-input text-sm file:mr-3 file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:text-secondary-foreground"
        />
        <p className="text-xs text-muted-foreground">
          A group CSV export, or a JSON backup. The file is parsed on this
          server and never sent anywhere else.
        </p>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <Upload aria-hidden="true" />
        )}
        Read the file
      </Button>
    </form>
  );
}
