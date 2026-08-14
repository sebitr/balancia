"use client";

import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { APPROXIMATE_DOWNLOAD_MB } from "@/lib/ocr/config";
import type { ScanProgress } from "@/lib/ocr/scanner";

/**
 * What the scanner is doing, said plainly.
 *
 * The rule this component exists to enforce: **a percentage is only shown when
 * a percentage is known.** Two of the stages can be counted honestly — bytes
 * arriving over the network, and lines read out of a known number of lines —
 * and those get a bar. The rest get a spinner and a sentence, because an
 * animated bar that is not measuring anything is a lie told to make waiting
 * feel shorter.
 */
export function ScanProgressView({ progress }: { progress: ScanProgress }) {
  const t = useTranslations("receiptScanner.progress");

  const percentage = determinatePercentage(progress);

  return (
    <div className="space-y-3 py-6" aria-live="polite" aria-busy="true">
      <div className="flex items-center gap-3">
        <Loader2
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin text-muted-foreground"
        />
        <p className="text-sm font-medium">{t(progress.stage)}</p>
        {percentage !== null && (
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {percentage}%
          </span>
        )}
      </div>

      {percentage !== null && <Progress value={percentage} />}

      {progress.stage === "downloading" && (
        // Said once, at the only moment it matters: this is a first-run cost,
        // not something that happens on every receipt.
        <p className="text-xs text-muted-foreground">
          {t("firstRun", { size: APPROXIMATE_DOWNLOAD_MB })}
        </p>
      )}
    </div>
  );
}

/** A percentage, or `null` when nothing real is being measured. */
function determinatePercentage(progress: ScanProgress): number | null {
  if (
    progress.stage === "downloading" &&
    progress.fileTotal &&
    progress.fileLoaded !== undefined
  ) {
    return Math.min(
      100,
      Math.round((progress.fileLoaded / progress.fileTotal) * 100),
    );
  }

  if (
    progress.stage === "reading" &&
    progress.total &&
    progress.done !== undefined
  ) {
    return Math.min(100, Math.round((progress.done / progress.total) * 100));
  }

  return null;
}
