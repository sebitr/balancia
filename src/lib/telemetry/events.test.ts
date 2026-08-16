import { describe, expect, it } from "vitest";
import {
  COUNTER_KEY_MAX_LENGTH,
  COUNTER_KEY_PATTERN,
  TELEMETRY_EVENT_NAMES,
  counterKeysFor,
  participantBucket,
  type TelemetryEvent,
} from "./events";

/**
 * The event vocabulary, and the mapper that turns it into stored data.
 *
 * The most valuable assertions in this file are the ones that do not run: the
 * `@ts-expect-error` cases below fail the *build* if the union ever grows a
 * field loose enough to hold somebody's data.
 */

/** One well-formed instance of every event, for the exhaustiveness checks. */
const SAMPLES: TelemetryEvent[] = [
  { name: "group_created", currencyMode: "converted" },
  {
    name: "expense_created",
    splitMethod: "percentage",
    direction: "out",
    multiCurrency: true,
    hasReceipt: true,
    participants: "6-10",
  },
  { name: "expense_updated", splitMethod: "equal" },
  { name: "settlement_created", multiCurrency: false },
  { name: "recurring_expense_created", frequency: "monthly" },
  { name: "receipt_attached", kind: "pdf" },
  { name: "receipt_ocr_used", outcome: "recognised" },
  { name: "splitwise_import_started", format: "csv" },
  { name: "splitwise_import_completed", outcome: "failure" },
  { name: "passkey_registered" },
  { name: "invite_created" },
  { name: "guest_joined" },
];

describe("the event vocabulary", () => {
  it("has a sample and a name entry for every member of the union", () => {
    // If this fails, a union member was added without deciding what it means
    // for the report — which is the moment to decide, not later.
    expect(SAMPLES.map((event) => event.name).sort()).toEqual(
      [...TELEMETRY_EVENT_NAMES].sort(),
    );
  });

  it("maps every event to at least its own name", () => {
    for (const event of SAMPLES) {
      expect(counterKeysFor(event), event.name).toContain(event.name);
    }
  });

  it("produces only well-formed, bounded keys", () => {
    for (const event of SAMPLES) {
      for (const key of counterKeysFor(event)) {
        expect(key, key).toMatch(COUNTER_KEY_PATTERN);
        expect(key.length, key).toBeLessThanOrEqual(COUNTER_KEY_MAX_LENGTH);
      }
    }
  });

  it("records the dimensions an expense was entered with, and no others", () => {
    expect(
      counterKeysFor({
        name: "expense_created",
        splitMethod: "shares",
        direction: "in",
        multiCurrency: true,
        hasReceipt: false,
        participants: "2-5",
      }),
    ).toEqual([
      "expense_created",
      "expense_created.split.shares",
      "expense_created.direction.in",
      "expense_created.participants.2-5",
      "expense_created.multi_currency",
    ]);
  });

  it("counts a fact only when it is true, never as its own 'no' counter", () => {
    const plain = counterKeysFor({
      name: "expense_created",
      splitMethod: "equal",
      direction: "out",
      multiCurrency: false,
      hasReceipt: false,
      participants: "1",
    });
    expect(plain).not.toContain("expense_created.multi_currency");
    expect(plain).not.toContain("expense_created.with_receipt");
    expect(plain.some((key) => key.includes("false"))).toBe(false);
  });

  it("slugs the closing bucket so keys stay in one alphabet", () => {
    expect(
      counterKeysFor({
        name: "expense_created",
        splitMethod: "equal",
        direction: "out",
        multiCurrency: false,
        hasReceipt: false,
        participants: "500+",
      }),
    ).toContain("expense_created.participants.500_plus");
  });

  it("buckets a participant count rather than passing it through", () => {
    expect(participantBucket(4)).toBe("2-5");
    expect(participantBucket(4000)).toBe("500+");
  });
});

describe("the type system, as a privacy control", () => {
  it("refuses a domain object where an event is expected", () => {
    const expense = {
      id: "3f1c6d5e-0b7a-4f2a-9c3d-2b8e1a4f6c7d",
      description: "Dinner at Chez Marie",
      amount: 8450n,
      currency: "EUR",
      participants: ["Ada", "Grace"],
    };

    // @ts-expect-error a domain object is not assignable to any event
    const attempt = () => counterKeysFor(expense);
    expect(attempt).toBeTypeOf("function");
  });

  it("refuses an extra property smuggled into a known event", () => {
    const attempt = () =>
      counterKeysFor({
        name: "group_created",
        currencyMode: "separate",
        // @ts-expect-error there is no field for a group's name, by design
        groupName: "Flat 4B",
      });
    expect(attempt).toBeTypeOf("function");
  });

  it("refuses a free string where a literal union is required", () => {
    const description: string = "Dinner at Chez Marie";
    const attempt = () =>
      counterKeysFor({
        name: "expense_created",
        // @ts-expect-error splitMethod is a closed union, not a string
        splitMethod: description,
        direction: "out",
        multiCurrency: false,
        hasReceipt: false,
        participants: "1",
      });
    expect(attempt).toBeTypeOf("function");
  });

  it("refuses an event name that is not in the vocabulary", () => {
    const attempt = () =>
      // @ts-expect-error unknown events have no mapper and cannot be recorded
      counterKeysFor({ name: "user_logged_in" });
    expect(attempt).toBeTypeOf("function");
  });
});

describe("what a mapped event cannot carry", () => {
  it("never emits a key containing anything but its own vocabulary", () => {
    // Every key is assembled from literals in the source. This is the runtime
    // half of the guarantee the type errors above make at build time.
    const forbidden = [
      /@/, // an address
      /\d{4,}/, // an amount or an identifier
      /[A-Z]/, // a name, or anything typed by a person
      /[ '"]/, // prose
    ];

    for (const event of SAMPLES) {
      for (const key of counterKeysFor(event)) {
        for (const pattern of forbidden) {
          expect(pattern.test(key), `${key} matched ${pattern}`).toBe(false);
        }
      }
    }
  });
});
