import { describe, expect, it, vi } from "vitest";
import { sendCrashReport, sendUsageReport } from "./transport";
import type { CrashReport, UsageReport } from "./schema";

/**
 * The outbound request.
 *
 * Two things are being checked: that a working send looks exactly as
 * documented, and that every way it can fail is survivable — because the
 * caller is a background job or an error handler, and telemetry is not allowed
 * to matter.
 */

const REPORT: UsageReport = {
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

const CRASH: CrashReport = {
  schema: 1,
  version: "1.8.2",
  error: "RecurrenceError",
  component: "scheduler",
  deployment: "docker-compose",
  database: "postgresql",
  architecture: "arm64",
};

const ENDPOINT = "https://telemetry.example.org";

function accepting(status = 202) {
  return vi.fn<typeof fetch>(async () => new Response(null, { status }));
}

/** The (url, init) pair a mocked fetch was called with. */
function callOf(
  fetchImpl: ReturnType<typeof accepting>,
  index = 0,
): [string, RequestInit] {
  const call = fetchImpl.mock.calls[index];
  expect(call, "expected a request to have been made").toBeDefined();
  return [String(call[0]), call[1] ?? {}];
}

describe("a successful send", () => {
  it("posts JSON to /v1/report and reports success", async () => {
    const fetchImpl = accepting();
    const result = await sendUsageReport(REPORT, {
      endpoint: ENDPOINT,
      fetchImpl,
    });

    expect(result).toEqual({ status: "sent" });
    const [url, init] = callOf(fetchImpl);
    expect(url).toBe("https://telemetry.example.org/v1/report");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(REPORT);
  });

  it("posts a crash classification to /v1/crash", async () => {
    const fetchImpl = accepting();
    await sendCrashReport(CRASH, { endpoint: ENDPOINT, fetchImpl });
    expect(callOf(fetchImpl)[0]).toBe("https://telemetry.example.org/v1/crash");
  });

  it("honours an endpoint with a path prefix", async () => {
    const fetchImpl = accepting();
    await sendUsageReport(REPORT, {
      endpoint: "https://example.org/api/telemetry",
      fetchImpl,
    });
    expect(callOf(fetchImpl)[0]).toBe(
      "https://example.org/api/telemetry/v1/report",
    );
  });

  it("sends nothing that could identify the instance across requests", async () => {
    const fetchImpl = accepting();
    await sendUsageReport(REPORT, { endpoint: ENDPOINT, fetchImpl });

    const [, init] = callOf(fetchImpl);
    const headers = init.headers as Record<string, string>;

    expect(Object.keys(headers).sort()).toEqual([
      "accept",
      "content-type",
      "user-agent",
    ]);
    expect(headers["content-type"]).toBe("application/json");
    // Deterministic and uninformative: the version is in the payload, where it
    // is documented, and nothing else belongs in a header.
    expect(headers["user-agent"]).toBe("Balancia");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect("credentials" in init).toBe(false);
  });

  it("does not read the response body", async () => {
    // Nothing a collector could say would be acted on, and not reading means a
    // hostile or broken response cannot become a parsing problem here.
    const body = new Response('{"malformed": ', { status: 202 });
    const readSpy = vi.spyOn(body, "json");
    const textSpy = vi.spyOn(body, "text");

    const result = await sendUsageReport(REPORT, {
      endpoint: ENDPOINT,
      fetchImpl: vi.fn(async () => body),
    });

    expect(result).toEqual({ status: "sent" });
    expect(readSpy).not.toHaveBeenCalled();
    expect(textSpy).not.toHaveBeenCalled();
  });
});

describe("failures, all of which are survivable", () => {
  it("reports a rejection without quoting the collector", async () => {
    const result = await sendUsageReport(REPORT, {
      endpoint: ENDPOINT,
      fetchImpl: vi.fn(
        async () =>
          new Response("go away, and here is why: …", { status: 400 }),
      ),
    });
    expect(result).toEqual({ status: "failed", reason: "rejected" });
  });

  it("survives a network failure", async () => {
    const result = await sendUsageReport(REPORT, {
      endpoint: ENDPOINT,
      fetchImpl: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    expect(result).toEqual({ status: "failed", reason: "network" });
  });

  it("gives up on a collector that accepts and then goes quiet", async () => {
    const result = await sendUsageReport(REPORT, {
      endpoint: ENDPOINT,
      timeoutMs: 10,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject((init.signal as AbortSignal).reason);
          });
        }),
    });
    expect(result).toEqual({ status: "failed", reason: "timeout" });
  });

  it("never retries", async () => {
    // A retry loop across thousands of installations is a way to build an
    // accidental denial of service against one's own collector.
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    await sendUsageReport(REPORT, { endpoint: ENDPOINT, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends nothing at all when there is no endpoint", async () => {
    const fetchImpl = accepting();
    const result = await sendUsageReport(REPORT, { endpoint: "", fetchImpl });
    expect(result).toEqual({ status: "failed", reason: "no-endpoint" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends nothing when the endpoint is not a URL", async () => {
    const fetchImpl = accepting();
    const result = await sendUsageReport(REPORT, {
      endpoint: "not a url",
      fetchImpl,
    });
    expect(result.status).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("what the transport refuses to send", () => {
  it("refuses a payload that does not validate", async () => {
    const fetchImpl = accepting();
    const result = await sendUsageReport(
      { ...REPORT, users: "seventeen" } as unknown as UsageReport,
      { endpoint: ENDPOINT, fetchImpl },
    );
    expect(result).toEqual({ status: "failed", reason: "invalid-payload" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a payload the schema allows but the content guard does not", async () => {
    // The belt to the schema's braces. `1.1234567.0` is a valid version as far
    // as the schema is concerned — and it contains a seven-digit run, which is
    // what an amount in minor units looks like. The guard does not know what
    // field it is looking at, which is the point of having it.
    const fetchImpl = accepting();

    expect(
      await sendCrashReport(CRASH, { endpoint: ENDPOINT, fetchImpl }),
    ).toEqual({ status: "sent" });

    const result = await sendCrashReport(
      { ...CRASH, version: "1.1234567.0" },
      { endpoint: ENDPOINT, fetchImpl },
    );

    expect(result).toEqual({ status: "failed", reason: "unsafe-payload" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses an oversized payload before it reaches the network", async () => {
    const fetchImpl = accepting();
    const huge = {
      ...REPORT,
      last7Days: {
        ...REPORT.last7Days,
        expenseParticipants: Object.fromEntries(
          Array.from({ length: 5_000 }, (_, index) => [
            `bucket-${index}`,
            "2-5",
          ]),
        ),
      },
    } as unknown as UsageReport;

    const result = await sendUsageReport(huge, {
      endpoint: ENDPOINT,
      fetchImpl,
    });
    expect(result.status).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cannot produce a valid report that approaches the size limit", () => {
    // Every field is a bucket label or an enum member and every object has a
    // fixed shape, so there is no input that makes a valid report large. The
    // 8 KiB bound exists for the *collector*, which is handed bodies by
    // strangers; here it can only ever be slack.
    expect(Buffer.byteLength(JSON.stringify(REPORT), "utf8")).toBeLessThan(
      1_500,
    );
  });
});
