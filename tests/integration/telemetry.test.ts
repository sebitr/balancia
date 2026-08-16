import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  instanceSettings,
  telemetryCounters,
  telemetryDailyStats,
  telemetryReports,
  users,
} from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  type UserActor,
} from "@/lib/security/authorization";
import { isInstanceAdmin, requireInstanceAdmin } from "@/lib/security/admin";
import { registerUser } from "@/modules/auth/service";
import { telemetry } from "@/lib/telemetry";
import {
  clearCounters,
  incrementCounters,
  pruneCounters,
  readCounters,
  utcDay,
  utcDayBefore,
} from "@/lib/telemetry/counters";
import { buildUsageReport } from "@/lib/telemetry/report";
import { providerFor } from "@/lib/telemetry/providers";
import {
  getEffectiveTelemetry,
  resetTelemetrySettingsCache,
  setTelemetrySetting,
} from "@/lib/telemetry/settings";
import {
  aggregateReceivedReports,
  ingestReport,
  pruneRawReports,
} from "@/lib/telemetry/receiver";
import { usageReportSchema } from "@/lib/telemetry/schema";
import { findForbiddenContent } from "@/lib/telemetry/guard";
import { createTestGroup, createTestUser } from "../helpers/factories";
import { createExpense } from "@/modules/expenses/service";
import { addTestParticipant, isoToday } from "../helpers/factories";

/**
 * Telemetry end to end, against a real database.
 *
 * The unit tests cover the parts that are pure — buckets, schemas,
 * sanitisation, precedence. What needs a database is the half that decides
 * whether anything is recorded at all, and this is where the promise on the
 * front of `docs/telemetry.md` is actually checked: a default installation
 * writes nothing, even while people use it.
 */

/** The signed-in user `requireInstanceAdmin` will see. */
const currentUser = vi.hoisted(() => ({ value: null as UserActor | null }));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () => currentUser.value,
  getCurrentActor: async () => currentUser.value,
  getClientIp: async () => "127.0.0.1",
}));

beforeEach(() => {
  resetTelemetrySettingsCache();
  currentUser.value = null;
});

async function enableUsageReporting(): Promise<void> {
  await setTelemetrySetting("usage", true);
  resetTelemetrySettingsCache();
}

async function countersNow(): Promise<Map<string, number>> {
  const today = utcDay(new Date());
  return readCounters(today, today);
}

describe("a default installation", () => {
  it("records nothing while people use it", async () => {
    // The claim on the front of the documentation, as a test: an instance
    // nobody has configured writes no telemetry at all.
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const other = await addTestParticipant(group.groupId, "Grace");

    await createExpense(group.access, {
      description: "Dinner at Chez Marie",
      amount: "8450",
      currency: "EUR",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "8450" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: other },
      ],
    });

    await telemetry.passkeyRegistered();
    await telemetry.guestJoined();

    expect([...(await countersNow()).keys()]).toEqual([]);
  });

  it("reports both switches off, and sends nothing", async () => {
    const settings = await getEffectiveTelemetry({ fresh: true });
    expect(settings.recording).toBe(false);
    expect(settings.transmitting).toBe(false);
    expect(settings.crashReporting).toBe(false);

    const outcome = await providerFor(settings).sendPeriodicReport();
    expect(outcome).toEqual({
      status: "skipped",
      reason: "not-transmitting",
    });
  });
});

describe("once an administrator opts in", () => {
  beforeEach(enableUsageReporting);

  it("records the coarse shape of an expense and nothing else", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, { currencyMode: "separate" });
    const other = await addTestParticipant(group.groupId, "Grace");

    await createExpense(group.access, {
      description: "Dinner at Chez Marie",
      amount: "8450",
      currency: "EUR",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "8450" }],
      splitMethod: "percentage",
      splitEntries: [
        { participantId: group.ownerParticipantId, value: "60" },
        { participantId: other, value: "40" },
      ],
    });

    const counters = await countersNow();
    expect(counters.get("expense_created")).toBe(1);
    expect(counters.get("expense_created.split.percentage")).toBe(1);
    expect(counters.get("expense_created.direction.out")).toBe(1);
    expect(counters.get("expense_created.participants.2-5")).toBe(1);

    // Nothing about *this* expense: not the description, not the amount, not
    // the currency, not who paid.
    const stored = JSON.stringify([...counters.keys()]);
    for (const secret of ["Marie", "8450", "EUR", "Grace", group.groupId]) {
      expect(stored, secret).not.toContain(secret);
    }
  });

  it("counts a group's currency mode when one is created", async () => {
    const actor = await createTestUser();
    await createTestGroup(actor, { currencyMode: "converted" });

    // The fixture writes rows directly; the service is what records, so drive
    // it through the module the application uses.
    await telemetry.groupCreated({ currencyMode: "converted" });

    const counters = await countersNow();
    expect(counters.get("group_created")).toBe(1);
    expect(counters.get("group_created.currency.converted")).toBe(1);
  });

  it("accumulates rather than writing a row per event", async () => {
    for (let index = 0; index < 5; index += 1) {
      await telemetry.passkeyRegistered();
    }

    const rows = await getDb()
      .select()
      .from(telemetryCounters)
      .where(eq(telemetryCounters.metric, "passkey_registered"));

    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(5);
  });

  it("refuses a metric key the schema's check constraint would not allow", async () => {
    // The database is the backstop for the mapper: a key that is not from the
    // closed vocabulary cannot be stored, whatever calls the counter helper.
    await expect(
      getDb()
        .insert(telemetryCounters)
        .values({
          day: utcDay(new Date()),
          metric: "expense_created.description.Dinner at Chez Marie",
          count: 1,
        }),
    ).rejects.toThrow();
  });

  it("forgets the counters when the switch goes back off", async () => {
    await telemetry.inviteCreated();
    expect((await countersNow()).size).toBeGreaterThan(0);

    await setTelemetrySetting("usage", false);
    await clearCounters();
    resetTelemetrySettingsCache();

    expect((await countersNow()).size).toBe(0);

    // And nothing new is recorded afterwards.
    await telemetry.inviteCreated();
    expect((await countersNow()).size).toBe(0);
  });
});

describe("the weekly report", () => {
  beforeEach(enableUsageReporting);

  it("is exactly what the preview shows, and validates", async () => {
    await createTestUser();
    await telemetry.expenseCreated({
      splitMethod: "equal",
      direction: "out",
      multiCurrency: true,
      hasReceipt: true,
      participantCount: 3,
    });

    const report = await buildUsageReport();

    expect(usageReportSchema.safeParse(report).success).toBe(true);
    expect(report.schema).toBe(1);
    expect(report.last7Days.expensesCreated).toBe("1");
    expect(report.last7Days.multiCurrencyExpenses).toBe("1");
    expect(report.last7Days.expensesWithReceipt).toBe("1");
    expect(report.last7Days.splitMethods.equal).toBe("1");
    expect(report.last7Days.expenseParticipants).toEqual({ "2-5": "1" });
  });

  it("carries no identifier for this installation", async () => {
    const report = await buildUsageReport();
    const serialized = JSON.stringify(report);

    for (const forbidden of [
      "installationId",
      "instanceId",
      "machineId",
      "hostname",
      "domain",
      "url",
      "localhost",
    ]) {
      expect(serialized.toLowerCase(), forbidden).not.toContain(
        forbidden.toLowerCase(),
      );
    }

    // Two reports built moments apart are indistinguishable.
    expect(JSON.stringify(await buildUsageReport())).toBe(serialized);
  });

  it("passes the content guard", async () => {
    await createTestUser({ name: "Ada Lovelace", email: "ada@example.com" });
    expect(findForbiddenContent(await buildUsageReport())).toBeNull();
  });

  it("buckets the installation's size rather than counting it", async () => {
    for (let index = 0; index < 7; index += 1) {
      await createTestUser();
    }
    const report = await buildUsageReport();
    expect(report.users).toBe("6-10");
    expect(JSON.stringify(report)).not.toContain('"7"');
  });

  it("covers seven days and ignores what happened before them", async () => {
    const now = new Date();
    await incrementCounters(["expense_created"], { now });
    await getDb()
      .insert(telemetryCounters)
      .values({
        day: utcDayBefore(now, 9),
        metric: "expense_created",
        count: 40,
      });

    const report = await buildUsageReport({ now });
    expect(report.last7Days.expensesCreated).toBe("1");
  });

  it("is dropped from the counters once it is old enough", async () => {
    const now = new Date();
    await getDb()
      .insert(telemetryCounters)
      .values([
        { day: utcDayBefore(now, 20), metric: "invite_created", count: 3 },
        { day: utcDay(now), metric: "invite_created", count: 1 },
      ]);

    const pruned = await pruneCounters(utcDayBefore(now, 14));
    expect(pruned).toBe(1);
    expect((await countersNow()).get("invite_created")).toBe(1);
  });

  it("records the outcome of an attempt for the administration page", async () => {
    const settings = await getEffectiveTelemetry({ fresh: true });
    expect(settings.transmitting).toBe(true);

    // No collector at the default endpoint from a test process: the attempt
    // fails, and failing is the behaviour under test — the application carries
    // on and the failure is visible to an administrator.
    const outcome = await providerFor({
      ...settings,
      endpoint: "http://127.0.0.1:1/collector",
    }).sendPeriodicReport();

    expect(outcome.status).toBe("failed");

    const [row] = await getDb()
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.id, 1));
    expect(row.lastReportStatus).toBe("failed");
    expect(row.lastReportSentAt).toBeNull();
  });
});

describe("the deployment's kill switch", () => {
  it("stops recording even with a stored opt-in", async () => {
    await enableUsageReporting();
    await telemetry.inviteCreated();
    expect((await countersNow()).size).toBe(1);

    process.env.TELEMETRY_MODE = "off";
    resetEnvCache();
    resetTelemetrySettingsCache();

    try {
      const settings = await getEffectiveTelemetry({ fresh: true });
      expect(settings.recording).toBe(false);
      expect(settings.usageLocked).toBe(true);

      await telemetry.inviteCreated();
      expect((await countersNow()).get("invite_created")).toBe(1);
    } finally {
      delete process.env.TELEMETRY_MODE;
      resetEnvCache();
      resetTelemetrySettingsCache();
    }
  });
});

describe("who may change any of this", () => {
  it("makes the first registered account the instance administrator", async () => {
    const first = await registerUser({
      name: "Ada",
      email: "ada@example.test",
      password: "correct horse battery staple",
    });
    const second = await registerUser({
      name: "Grace",
      email: "grace@example.test",
      password: "correct horse battery staple",
    });

    expect(await isInstanceAdmin(first.user.userId)).toBe(true);
    expect(await isInstanceAdmin(second.user.userId)).toBe(false);
  });

  it("grants nothing to somebody who merely owns a group", async () => {
    // Group ownership is about one group's money. The owner of a group is not
    // the owner of the server, and on a shared instance they are not even
    // usually the same person.
    const actor = await createTestUser();
    await createTestGroup(actor);
    expect(await isInstanceAdmin(actor.userId)).toBe(false);
  });

  it("refuses a signed-out caller", async () => {
    currentUser.value = null;
    await expect(requireInstanceAdmin()).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    );
  });

  it("refuses an ordinary participant", async () => {
    const actor = await createTestUser();
    currentUser.value = actor;
    await expect(requireInstanceAdmin()).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("admits an administrator", async () => {
    const actor = await createTestUser();
    await getDb()
      .update(users)
      .set({ isAdmin: true })
      .where(eq(users.id, actor.userId));

    currentUser.value = actor;
    await expect(requireInstanceAdmin()).resolves.toMatchObject({
      userId: actor.userId,
    });
  });

  it("stops being an administrator the moment the flag is removed", async () => {
    const actor = await createTestUser();
    const db = getDb();
    await db
      .update(users)
      .set({ isAdmin: true })
      .where(eq(users.id, actor.userId));
    expect(await isInstanceAdmin(actor.userId)).toBe(true);

    await db
      .update(users)
      .set({ isAdmin: false })
      .where(eq(users.id, actor.userId));
    expect(await isInstanceAdmin(actor.userId)).toBe(false);
  });
});

describe("the collector", () => {
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

  it("accepts a valid report and stores nothing about the sender", async () => {
    expect(await ingestReport("usage", REPORT)).toEqual({ ok: true });

    const [row] = await getDb().select().from(telemetryReports);
    expect(row.kind).toBe("usage");
    expect(row.schemaVersion).toBe(1);
    expect(row.payload).toEqual(REPORT);

    // There is no column for a sender, and nothing about the request was
    // passed in to put in one.
    expect(Object.keys(row).sort()).toEqual([
      "id",
      "kind",
      "payload",
      "receivedAt",
      "receivedOn",
      "schemaVersion",
    ]);
  });

  it("rejects an unknown property rather than discarding it", async () => {
    const outcome = await ingestReport("usage", {
      ...REPORT,
      installationId: "3f1c6d5e-0b7a-4f2a-9c3d-2b8e1a4f6c7d",
    });

    expect(outcome).toEqual({
      ok: false,
      status: 400,
      error: "invalid-payload",
    });
    expect(await getDb().select().from(telemetryReports)).toEqual([]);
  });

  it("refuses a schema version it does not know, clearly", async () => {
    expect(await ingestReport("usage", { ...REPORT, schema: 99 })).toEqual({
      ok: false,
      status: 422,
      error: "unknown-schema",
    });
  });

  it("refuses a payload that is not a report at all", async () => {
    for (const payload of [null, "a string", 42, [], {}]) {
      const outcome = await ingestReport("usage", payload);
      expect(outcome.ok, JSON.stringify(payload)).toBe(false);
    }
  });

  it("refuses a report whose fields pass the schema but not the guard", async () => {
    const outcome = await ingestReport("crash", {
      schema: 1,
      version: "1.1234567.0",
      error: "RecurrenceError",
      component: "scheduler",
      deployment: "docker",
      database: "postgresql",
      architecture: "amd64",
    });
    expect(outcome).toEqual({
      ok: false,
      status: 400,
      error: "unsafe-payload",
    });
  });

  it("folds reports into daily counts and deletes the raw payloads", async () => {
    await ingestReport("usage", REPORT);
    await ingestReport("usage", REPORT);
    await ingestReport("usage", { ...REPORT, architecture: "amd64" });

    const outcome = await aggregateReceivedReports();
    expect(outcome.folded).toBe(3);
    expect(outcome.deleted).toBe(3);
    expect(await getDb().select().from(telemetryReports)).toEqual([]);

    const stats = await getDb().select().from(telemetryDailyStats);
    const byKey = new Map(
      stats.map((row) => [`${row.field}=${row.value}`, row.count]),
    );
    expect(byKey.get("architecture=arm64")).toBe(2);
    expect(byKey.get("architecture=amd64")).toBe(1);
    expect(byKey.get("last7Days.ocrUses=6-10")).toBe(3);
    expect(byKey.get("features.push=true")).toBe(3);
  });

  it("adds to an existing day rather than replacing it", async () => {
    await ingestReport("usage", REPORT);
    await aggregateReceivedReports();
    await ingestReport("usage", REPORT);
    await aggregateReceivedReports();

    const [row] = await getDb()
      .select()
      .from(telemetryDailyStats)
      .where(eq(telemetryDailyStats.field, "version"));
    expect(row.count).toBe(2);
  });

  it("drops raw payloads that were never folded", async () => {
    await ingestReport("usage", REPORT);
    await getDb()
      .update(telemetryReports)
      .set({ receivedOn: utcDayBefore(new Date(), 30) });

    expect(await pruneRawReports()).toBe(1);
    expect(await getDb().select().from(telemetryReports)).toEqual([]);
  });

  describe("its HTTP surface", () => {
    /** Runs a request through the ingest handler with the receiver switched on. */
    async function post(
      body: string | undefined,
      init: { contentType?: string | null; length?: string } = {},
      options: { receiver?: boolean } = {},
    ): Promise<Response> {
      process.env.TELEMETRY_RECEIVER =
        options.receiver === false ? "false" : "true";
      resetEnvCache();
      try {
        const { ingest } = await import("@/app/api/telemetry/v1/ingest");
        const { NextRequest } = await import("next/server");

        const headers = new Headers();
        if (init.contentType !== null) {
          headers.set("content-type", init.contentType ?? "application/json");
        }
        if (init.length) headers.set("content-length", init.length);
        // A source address the handler is expected to hash rather than store.
        headers.set(
          "x-forwarded-for",
          `203.0.113.${Math.floor(Math.random() * 250) + 1}`,
        );

        return await ingest(
          "usage",
          new NextRequest("https://telemetry.example.org/v1/report", {
            method: "POST",
            headers,
            body,
          }),
        );
      } finally {
        delete process.env.TELEMETRY_RECEIVER;
        resetEnvCache();
      }
    }

    it("does not exist unless this deployment is a collector", async () => {
      const response = await post(
        JSON.stringify(REPORT),
        {},
        { receiver: false },
      );
      // 404 rather than 403: an instance that is not collecting should not
      // advertise that the endpoint would exist if it were.
      expect(response.status).toBe(404);
    });

    it("accepts a valid report", async () => {
      const response = await post(JSON.stringify(REPORT));
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ ok: true });
    });

    it("insists on JSON", async () => {
      const response = await post(JSON.stringify(REPORT), {
        contentType: "text/plain",
      });
      expect(response.status).toBe(415);
    });

    it("refuses a body larger than the limit, by its declared length", async () => {
      const response = await post(JSON.stringify(REPORT), { length: "99999" });
      expect(response.status).toBe(413);
    });

    it("refuses an oversized body that declared nothing", async () => {
      const padded = JSON.stringify({
        ...REPORT,
        version: "1.8.2",
        padding: "x".repeat(20_000),
      });
      const response = await post(padded);
      expect(response.status).toBe(413);
    });

    it("refuses malformed JSON without trying to make sense of it", async () => {
      const response = await post('{"schema": 1, ');
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid json" });
    });

    it("says which rule refused a payload, and nothing about the payload", async () => {
      const response = await post(
        JSON.stringify({ ...REPORT, adminEmail: "john@example.com" }),
      );
      expect(response.status).toBe(400);
      const body = JSON.stringify(await response.json());
      expect(body).toBe('{"error":"invalid-payload"}');
      expect(body).not.toContain("john");
    });

    it("stores no address for the source it rate limits", async () => {
      await post(JSON.stringify(REPORT));

      const limits = await getDb().execute(
        sql`SELECT bucket FROM rate_limits WHERE bucket LIKE 'telemetryIngest:%'`,
      );
      expect(limits.rows.length).toBeGreaterThan(0);
      for (const row of limits.rows) {
        const bucket = (row as { bucket: string }).bucket;
        expect(bucket).not.toMatch(/203\.0\.113/);
        // A 32-character hex digest of (day, address) under the instance
        // secret — a pseudonym, swept within a day. See docs/telemetry.md.
        expect(bucket).toMatch(/^telemetryIngest:[0-9a-f]{32}$/);
      }
    });
  });

  it("keeps only counts, with nothing joinable to a sender", async () => {
    await ingestReport("usage", REPORT);
    await aggregateReceivedReports();

    const columns = await getDb().execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'telemetry_daily_stats'`,
    );
    expect(
      columns.rows
        .map((row) => (row as { column_name: string }).column_name)
        .sort(),
    ).toEqual(["count", "day", "field", "kind", "value"]);
  });
});
