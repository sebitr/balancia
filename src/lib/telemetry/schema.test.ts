import { describe, expect, it } from "vitest";
import {
  MAX_PAYLOAD_BYTES,
  TELEMETRY_SCHEMA_VERSION,
  crashReportSchema,
  usageReportSchema,
} from "./schema";

/**
 * The wire contract.
 *
 * Both ends read these schemas, so what they accept *is* the documented list
 * of collected fields — and what they refuse is the enforcement of everything
 * `docs/telemetry.md` says is never collected.
 */

const REPORT = {
  schema: 1,
  version: "1.8.2",
  deployment: "docker-compose",
  database: "postgresql",
  architecture: "arm64",
  instanceAge: "91-180d",
  users: "6-10",
  groups: "11-25",
  features: {
    registrationOpen: false,
    email: true,
    push: true,
    appleSignIn: false,
    exchangeRates: false,
    receiptScanning: true,
    semanticCategorization: false,
    storage: "local",
    worker: "separate",
  },
  last7Days: {
    groupsCreated: "1",
    expensesCreated: "51-100",
    expensesUpdated: "6-10",
    settlementsCreated: "6-10",
    recurringExpensesCreated: "1",
    multiCurrencyExpenses: "11-25",
    expensesWithReceipt: "11-25",
    receiptsAttached: "11-25",
    ocrUses: "6-10",
    splitwiseImportsStarted: "0",
    splitwiseImportsCompleted: "0",
    passkeysRegistered: "1",
    invitesCreated: "2-5",
    guestsJoined: "2-5",
    splitMethods: {
      equal: "26-50",
      exact: "2-5",
      percentage: "6-10",
      shares: "1",
    },
  },
};

const CRASH = {
  schema: 1,
  version: "1.8.2",
  error: "RecurringExpenseGenerationError",
  component: "scheduler",
  deployment: "docker-compose",
  database: "postgresql",
  architecture: "arm64",
};

describe("the usage report schema", () => {
  it("accepts a complete report", () => {
    expect(usageReportSchema.safeParse(REPORT).success).toBe(true);
  });

  it("carries the current schema version", () => {
    expect(TELEMETRY_SCHEMA_VERSION).toBe(1);
    expect(usageReportSchema.safeParse({ ...REPORT, schema: 2 }).success).toBe(
      false,
    );
  });

  it("rejects an unknown property rather than dropping it", () => {
    // The documented policy: a field nobody agreed to send is a bug at one end
    // or the other, and accepting it quietly would make the list of collected
    // fields a claim rather than a fact.
    for (const extra of [
      { installationId: "3f1c6d5e" },
      { hostname: "balancia.example.com" },
      { instanceUrl: "https://balancia.example.com" },
      { adminEmail: "john@example.com" },
    ]) {
      const result = usageReportSchema.safeParse({ ...REPORT, ...extra });
      expect(result.success, Object.keys(extra)[0]).toBe(false);
    }
  });

  it("rejects an unknown property nested inside a known object", () => {
    expect(
      usageReportSchema.safeParse({
        ...REPORT,
        features: { ...REPORT.features, timezone: "Europe/Paris" },
      }).success,
    ).toBe(false);

    expect(
      usageReportSchema.safeParse({
        ...REPORT,
        last7Days: { ...REPORT.last7Days, totalSpent: "84500" },
      }).success,
    ).toBe(false);
  });

  it("rejects an exact count where a bucket is required", () => {
    for (const value of [17, "17", "51", "many"]) {
      expect(
        usageReportSchema.safeParse({
          ...REPORT,
          last7Days: { ...REPORT.last7Days, expensesCreated: value },
        }).success,
        String(value),
      ).toBe(false);
    }
  });

  it("rejects a version that is not a version", () => {
    for (const version of [
      "balancia.example.com",
      "1.8",
      "",
      "1.8.2 (build by john@example.com)",
    ]) {
      expect(
        usageReportSchema.safeParse({ ...REPORT, version }).success,
        version,
      ).toBe(false);
    }
    expect(
      usageReportSchema.safeParse({ ...REPORT, version: "1.8.2-rc.1" }).success,
    ).toBe(true);
  });

  it("accepts a participant distribution keyed only by buckets", () => {
    expect(
      usageReportSchema.safeParse({
        ...REPORT,
        last7Days: {
          ...REPORT.last7Days,
          expenseParticipants: { "2-5": "51-100", "6-10": "2-5" },
        },
      }).success,
    ).toBe(true);

    expect(
      usageReportSchema.safeParse({
        ...REPORT,
        last7Days: {
          ...REPORT.last7Days,
          expenseParticipants: { "4": "51-100" },
        },
      }).success,
    ).toBe(false);
  });

  it("has a size limit that a real report is comfortably inside", () => {
    const size = Buffer.byteLength(JSON.stringify(REPORT), "utf8");
    expect(size).toBeLessThan(MAX_PAYLOAD_BYTES / 2);
  });
});

describe("the crash report schema", () => {
  it("accepts a classification", () => {
    expect(crashReportSchema.safeParse(CRASH).success).toBe(true);
  });

  it("refuses anything in the error field that is not a class name", () => {
    for (const error of [
      "Failed to load https://balancia.example.com/groups/123",
      "john@example.com",
      "Error: Chez Marie",
      "TypeError\n    at createExpense (service.ts:215)",
      "",
    ]) {
      expect(
        crashReportSchema.safeParse({ ...CRASH, error }).success,
        error.slice(0, 24),
      ).toBe(false);
    }
  });

  it("refuses a component that is not one of the known parts", () => {
    expect(
      crashReportSchema.safeParse({
        ...CRASH,
        component: "/app/src/modules/expenses/service.ts",
      }).success,
    ).toBe(false);
  });

  it("refuses the fields somebody would be tempted to add", () => {
    for (const extra of [
      { message: "duplicate key value violates unique constraint" },
      { stack: "Error: boom\n    at createExpense (service.ts:215:11)" },
      { path: "/groups/123/expenses/456" },
      { userId: "3f1c6d5e-0b7a-4f2a-9c3d-2b8e1a4f6c7d" },
    ]) {
      expect(
        crashReportSchema.safeParse({ ...CRASH, ...extra }).success,
        Object.keys(extra)[0],
      ).toBe(false);
    }
  });
});
