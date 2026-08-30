/**
 * The complete vocabulary of product telemetry.
 *
 * Every event Balancia can record is one member of the union below, and every
 * field of every member is a *closed literal type* — a boolean, or a value
 * chosen from a list written here. There is deliberately no `track(name, data)`
 * that takes a string and an object: a description, a merchant, an amount or a
 * participant name has nowhere to go, because no field in this file can hold
 * one. That is the privacy guarantee, expressed as types rather than as a
 * warning in a comment.
 *
 * Adding a field here is a decision to collect it. Make it a literal union,
 * name it in `docs/telemetry.md`, and give it a counter key below.
 */

import { bucketCount, type CountBucket } from "./buckets";

/** How a group converts currencies, as recorded on the group itself. */
export type CurrencyMode = "separate" | "converted";

/** The split methods the expense form offers. */
export type SplitMethod = "equal" | "exact" | "percentage" | "shares";

/** Spending or money received on the group's behalf. */
export type EntryDirection = "out" | "in";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

/** What a receipt file turned out to be. Not its name, and not its contents. */
export type AttachmentKind = "image" | "pdf";

/** How a scan ended. `empty` is "the models read nothing usable". */
export type ScanOutcome = "recognised" | "empty" | "failed";

export type ImportFormat = "csv" | "json";

export type Outcome = "success" | "failure";

/**
 * One recorded product action.
 *
 * The names match `docs/telemetry.md` exactly; they are part of the report's
 * public contract and are not renamed without a schema version.
 */
export type TelemetryEvent =
  | { readonly name: "group_created"; readonly currencyMode: CurrencyMode }
  | {
      readonly name: "expense_created";
      readonly splitMethod: SplitMethod;
      readonly direction: EntryDirection;
      readonly multiCurrency: boolean;
      readonly hasReceipt: boolean;
      /** How many people the expense was split between, as a bucket. */
      readonly participants: CountBucket;
    }
  | { readonly name: "expense_updated"; readonly splitMethod: SplitMethod }
  | { readonly name: "settlement_created"; readonly multiCurrency: boolean }
  | {
      readonly name: "recurring_expense_created";
      readonly frequency: RecurrenceFrequency;
    }
  | { readonly name: "receipt_attached"; readonly kind: AttachmentKind }
  | { readonly name: "receipt_ocr_used"; readonly outcome: ScanOutcome }
  | {
      readonly name: "splitwise_import_started";
      readonly format: ImportFormat;
    }
  | {
      readonly name: "splitwise_import_completed";
      readonly outcome: Outcome;
    }
  | { readonly name: "passkey_registered" }
  | { readonly name: "invite_created" }
  | { readonly name: "guest_joined" };

export type TelemetryEventName = TelemetryEvent["name"];

/**
 * Every event name, for validation and for the admin preview.
 *
 * Written out rather than derived, so that adding a union member without
 * deciding what it means for the report is a test failure rather than a silent
 * new counter.
 */
export const TELEMETRY_EVENT_NAMES = [
  "group_created",
  "expense_created",
  "expense_updated",
  "settlement_created",
  "recurring_expense_created",
  "receipt_attached",
  "receipt_ocr_used",
  "splitwise_import_started",
  "splitwise_import_completed",
  "passkey_registered",
  "invite_created",
  "guest_joined",
] as const satisfies readonly TelemetryEventName[];

/**
 * A local counter key: the event name, optionally followed by one dimension.
 *
 * Keys are assembled from literal types only — `expense_created.split.equal`
 * can be produced, `expense_created.split.${description}` cannot, because
 * `splitMethod` is not a `string`.
 */
export type CounterKey = string;

/** Rejects anything that is not a well-formed key, as a last line of defence. */
export const COUNTER_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_-]+){0,2}$/;

/** The longest key the counter table stores; keeps one bad call from bloating it. */
export const COUNTER_KEY_MAX_LENGTH = 64;

/**
 * The explicit mapper: domain event → the counters it increments.
 *
 * This is the only place an event turns into stored data. It returns keys, not
 * objects, so nothing structural from the caller can survive the trip: the
 * event is read field by field, and everything not read here is discarded.
 */
export function counterKeysFor(event: TelemetryEvent): readonly CounterKey[] {
  switch (event.name) {
    case "group_created":
      return ["group_created", `group_created.currency.${event.currencyMode}`];

    case "expense_created": {
      const keys = [
        "expense_created",
        `expense_created.split.${event.splitMethod}`,
        `expense_created.direction.${event.direction}`,
        `expense_created.participants.${slug(event.participants)}`,
      ];
      // Absence is counted as the total minus the flag, not as its own key:
      // one counter per interesting fact, and no counter that only says "no".
      if (event.multiCurrency) keys.push("expense_created.multi_currency");
      if (event.hasReceipt) keys.push("expense_created.with_receipt");
      return keys;
    }

    case "expense_updated":
      return ["expense_updated", `expense_updated.split.${event.splitMethod}`];

    case "settlement_created": {
      const keys = ["settlement_created"];
      if (event.multiCurrency) keys.push("settlement_created.multi_currency");
      return keys;
    }

    case "recurring_expense_created":
      return [
        "recurring_expense_created",
        `recurring_expense_created.frequency.${event.frequency}`,
      ];

    case "receipt_attached":
      return ["receipt_attached", `receipt_attached.kind.${event.kind}`];

    case "receipt_ocr_used":
      return ["receipt_ocr_used", `receipt_ocr_used.outcome.${event.outcome}`];

    case "splitwise_import_started":
      return [
        "splitwise_import_started",
        `splitwise_import_started.format.${event.format}`,
      ];

    case "splitwise_import_completed":
      return [
        "splitwise_import_completed",
        `splitwise_import_completed.outcome.${event.outcome}`,
      ];

    case "passkey_registered":
      return ["passkey_registered"];

    case "invite_created":
      return ["invite_created"];

    case "guest_joined":
      return ["guest_joined"];
  }
}

/**
 * Bucket labels contain characters a key must not (`+`, `-` is fine).
 * `"500+"` becomes `500_plus` so keys stay in one readable alphabet.
 */
function slug(bucket: CountBucket): string {
  return bucket.replace("+", "_plus");
}

/** Convenience for callers holding a raw participant count. */
export function participantBucket(count: number): CountBucket {
  return bucketCount(count);
}
