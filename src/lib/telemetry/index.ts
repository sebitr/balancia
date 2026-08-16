import "server-only";
import { logger } from "@/lib/logger";
import type {
  AttachmentKind,
  CurrencyMode,
  EntryDirection,
  ImportFormat,
  Outcome,
  RecurrenceFrequency,
  ScanOutcome,
  SplitMethod,
  TelemetryEvent,
} from "./events";
import { participantBucket } from "./events";
import { providerFor } from "./providers";
import { getEffectiveTelemetry } from "./settings";

/**
 * What the rest of Balancia calls.
 *
 * One named function per product event, each taking a small object of literal
 * types. There is deliberately no `track(name, payload)`: with this shape,
 *
 *     telemetry.expenseCreated(expense)
 *
 * does not compile. An `Expense` has a description, an amount and a list of
 * participant ids, and none of those is assignable to any parameter here — so
 * the mistake that leaks financial data is a type error at the call site
 * rather than a review comment somebody has to remember to write.
 *
 * Every function resolves rather than rejects. A domain service awaits these
 * *after* its transaction has committed, so a telemetry failure can neither
 * roll back an expense nor surface to the person who created it; the failure
 * is logged locally at debug level, which is where an administrator can find
 * it and nobody else is bothered by it.
 */

async function record(event: TelemetryEvent): Promise<void> {
  try {
    const settings = await getEffectiveTelemetry();
    if (!settings.recording) return;
    await providerFor(settings).track(event);
  } catch (error) {
    // Deliberately quiet. Telemetry that cannot be recorded is not a fault the
    // application should react to, and an error here must never become an
    // error the user sees.
    logger.debug(
      { err: error instanceof Error ? error.name : "unknown" },
      "Telemetry event not recorded",
    );
  }
}

export const telemetry = {
  groupCreated(input: { currencyMode: CurrencyMode }): Promise<void> {
    return record({ name: "group_created", currencyMode: input.currencyMode });
  },

  expenseCreated(input: {
    splitMethod: SplitMethod;
    direction: EntryDirection;
    multiCurrency: boolean;
    hasReceipt: boolean;
    /** A count, bucketed here so no call site has to remember to. */
    participantCount: number;
  }): Promise<void> {
    return record({
      name: "expense_created",
      splitMethod: input.splitMethod,
      direction: input.direction,
      multiCurrency: input.multiCurrency,
      hasReceipt: input.hasReceipt,
      participants: participantBucket(input.participantCount),
    });
  },

  expenseUpdated(input: { splitMethod: SplitMethod }): Promise<void> {
    return record({
      name: "expense_updated",
      splitMethod: input.splitMethod,
    });
  },

  settlementCreated(input: { multiCurrency: boolean }): Promise<void> {
    return record({
      name: "settlement_created",
      multiCurrency: input.multiCurrency,
    });
  },

  recurringExpenseCreated(input: {
    frequency: RecurrenceFrequency;
  }): Promise<void> {
    return record({
      name: "recurring_expense_created",
      frequency: input.frequency,
    });
  },

  receiptAttached(input: { kind: AttachmentKind }): Promise<void> {
    return record({ name: "receipt_attached", kind: input.kind });
  },

  receiptScanUsed(input: { outcome: ScanOutcome }): Promise<void> {
    return record({ name: "receipt_ocr_used", outcome: input.outcome });
  },

  splitwiseImportStarted(input: { format: ImportFormat }): Promise<void> {
    return record({ name: "splitwise_import_started", format: input.format });
  },

  splitwiseImportCompleted(input: { outcome: Outcome }): Promise<void> {
    return record({
      name: "splitwise_import_completed",
      outcome: input.outcome,
    });
  },

  passkeyRegistered(): Promise<void> {
    return record({ name: "passkey_registered" });
  },

  inviteCreated(): Promise<void> {
    return record({ name: "invite_created" });
  },

  guestJoined(): Promise<void> {
    return record({ name: "guest_joined" });
  },
} as const;

export type Telemetry = typeof telemetry;
