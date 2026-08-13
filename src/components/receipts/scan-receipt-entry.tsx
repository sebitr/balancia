"use client";

import { useEffect, useState } from "react";
import { isScanningAvailable } from "@/lib/ocr/scanner";
import { ScanReceiptDialog, type ScannedExpense } from "./scan-receipt-dialog";
import type { Participant } from "./item-assignment";

/**
 * The scan entry point, rendered only where it will actually work.
 *
 * Three things have to be true, and they are checked in increasing order of
 * cost: the operator enabled the feature (a prop, decided on the server), the
 * browser can run a worker and WebAssembly (synchronous), and the models are
 * installed (one HEAD request).
 *
 * Until all three hold, nothing renders. A scan button that opens onto an
 * error is worse than no scan button, and the expense form works exactly as it
 * always has without it.
 */
export function ScanReceiptEntry({
  enabled,
  groupId,
  participants,
  defaultCurrency,
  onApply,
}: {
  /** Whether the operator switched receipt scanning on for this instance. */
  enabled: boolean;
  groupId: string;
  participants: readonly Participant[];
  defaultCurrency: string;
  onApply: (result: ScannedExpense) => void;
}) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void isScanningAvailable().then((result) => {
      if (!cancelled) setAvailable(result);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled || !available || participants.length === 0) return null;

  return (
    <ScanReceiptDialog
      groupId={groupId}
      participants={participants}
      defaultCurrency={defaultCurrency}
      onApply={onApply}
    />
  );
}

export type { ScannedExpense };
