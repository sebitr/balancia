"use client";

import { useEffect, useState } from "react";
import { isLocalReadingAvailable } from "@/lib/ocr/reader";
import {
  ScanReceiptDialog,
  type CaptureActions,
  type ScannedExpense,
} from "./scan-receipt-dialog";
import type { Participant } from "./item-assignment";

/**
 * The scan entry point, rendered only where it will actually work.
 *
 * There are two readers now, and the button appears if *either* can run:
 *
 *  - the on-device one, which needs the operator to have left it on, a
 *    browser with a worker and WebAssembly, and the models installed (one
 *    HEAD request, and the only expensive check here); or
 *  - a server-side provider, which needs nothing of the device at all —
 *    knowing it is configured is enough, and that is decided on the server.
 *
 * Until one of them holds, nothing renders. A scan button that opens onto an
 * error is worse than no scan button, and the expense form works exactly as it
 * always has without it.
 */
export function ScanReceiptEntry({
  enabled,
  localEnabled,
  provider,
  groupId,
  participants,
  defaultCurrency,
  onApply,
  trigger,
}: {
  /** Whether the operator switched receipt scanning on for this instance. */
  enabled: boolean;
  /** Whether the on-device reader is switched on (`RECEIPT_OCR_LOCAL`). */
  localEnabled: boolean;
  /**
   * The server-side reader the operator configured, named for the interface,
   * or undefined when there is none. Never a key — only which one it is.
   */
  provider?: string;
  groupId: string;
  participants: readonly Participant[];
  defaultCurrency: string;
  onApply: (result: ScannedExpense) => void;
  /** Replaces the default button — the add-entry screen passes its scan card. */
  trigger?: React.ComponentType<CaptureActions>;
}) {
  const [localAvailable, setLocalAvailable] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void isLocalReadingAvailable(localEnabled).then((result) => {
      if (!cancelled) setLocalAvailable(result);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, localEnabled]);

  // A provider needs no probe: the server already knows it is configured.
  const available = localAvailable || provider !== undefined;
  if (!enabled || !available || participants.length === 0) return null;

  return (
    <ScanReceiptDialog
      localAvailable={localAvailable}
      provider={provider}
      groupId={groupId}
      participants={participants}
      defaultCurrency={defaultCurrency}
      onApply={onApply}
      trigger={trigger}
    />
  );
}

export type { CaptureActions, ScannedExpense };
