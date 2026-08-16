import type { UsageReport } from "@/lib/telemetry/schema";

/**
 * The payload, exactly as it would be transmitted.
 *
 * `JSON.stringify` of the object the report builder returned — the same object
 * the transport would serialize. There is no sample payload in this repository
 * for this to display instead: a preview that showed one would be a claim
 * about what Balancia sends, and the point of this screen is that it is
 * evidence.
 */
export function TelemetryPreview({ report }: { report: UsageReport }) {
  return (
    <pre
      data-slot="telemetry-preview"
      className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed"
    >
      {JSON.stringify(report, null, 2)}
    </pre>
  );
}
