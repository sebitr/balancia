import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { expenses } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import { resetRatesProviderCache } from "@/modules/currencies/provider";
import {
  isProviderQuotedRate,
  lookupRate,
  refreshActiveRates,
} from "@/modules/currencies/rates";
import { createTestGroup, createTestUser } from "../helpers/factories";

/**
 * The cached rate lookup, against a real database and a stubbed provider.
 *
 * What is being pinned down here is the caching contract: how few times the
 * provider is called, and what happens when it stops answering.
 */

const now = new Date("2026-08-13T18:00:00.000Z");

function enableProvider(): void {
  process.env.EXCHANGE_RATE_PROVIDER = "frankfurter";
  // A v2 root, because `env.ts` refuses a v1 one at boot — the fixture has to
  // be a URL the app would actually accept, or every test here dies in
  // configuration rather than in the code it is about.
  process.env.EXCHANGE_RATE_API_URL = "https://rates.test/v2";
  resetEnvCache();
  resetRatesProviderCache();
}

function stubProvider(
  body: unknown,
  options: { status?: number } = {},
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), { status: options.status ?? 200 }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function failingProvider(): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => {
    throw new TypeError("fetch failed");
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/**
 * A v2 response: one row per quote currency, each carrying the day that pair
 * was priced.
 *
 * The day is per row rather than per response because Frankfurter blends
 * providers that do not publish on the same schedule — which is the whole
 * reason the provider reads it off each row, and why the "aged out" test below
 * hands the same quotes back under yesterday's date.
 */
function usdQuotes(date = "2026-08-13") {
  return [
    { date, base: "USD", quote: "EUR", rate: 0.86618 },
    { date, base: "USD", quote: "JPY", rate: 159.09 },
    { date, base: "USD", quote: "GBP", rate: 0.74352 },
  ];
}

beforeAll(() => {
  enableProvider();
});

afterEach(() => {
  vi.unstubAllGlobals();
  enableProvider();
});

describe("lookupRate", () => {
  it("fetches once and serves the cache afterwards", async () => {
    const fetchMock = stubProvider(usdQuotes());

    const first = await lookupRate({
      from: "USD",
      to: "EUR",
      on: "2026-08-13",
      now,
    });
    const second = await lookupRate({
      from: "USD",
      to: "EUR",
      on: "2026-08-13",
      now,
    });

    expect(first).toEqual({
      rate: "0.86618",
      quotedOn: "2026-08-13",
      provider: "frankfurter",
    });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stores every quote in the response, so a sibling pair costs no call", async () => {
    const fetchMock = stubProvider(usdQuotes());

    await lookupRate({ from: "USD", to: "EUR", on: "2026-08-13", now });
    const yen = await lookupRate({
      from: "USD",
      to: "JPY",
      on: "2026-08-13",
      now,
    });

    expect(yen?.rate).toBe("159.09");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-asks once a provisional quote has aged out", async () => {
    // Today's fixing is not published yet: this is yesterday's.
    const fetchMock = stubProvider(usdQuotes("2026-08-12"));

    await lookupRate({ from: "USD", to: "EUR", on: "2026-08-13", now });
    await lookupRate({ from: "USD", to: "EUR", on: "2026-08-13", now });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await lookupRate({
      from: "USD",
      to: "EUR",
      on: "2026-08-13",
      now: new Date(now.getTime() + 2 * 60 * 60 * 1000),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serves a stale quote when the provider stops answering", async () => {
    stubProvider(usdQuotes("2026-08-12"));
    await lookupRate({ from: "USD", to: "EUR", on: "2026-08-13", now });

    vi.unstubAllGlobals();
    const failing = failingProvider();
    const later = new Date(now.getTime() + 5 * 60 * 60 * 1000);

    const quote = await lookupRate({
      from: "USD",
      to: "EUR",
      on: "2026-08-13",
      now: later,
    });

    expect(failing).toHaveBeenCalledTimes(1);
    expect(quote?.rate).toBe("0.86618");
  });

  it("returns null when the provider has no data for the pair", async () => {
    stubProvider({ message: "not found" }, { status: 404 });

    await expect(
      lookupRate({ from: "USD", to: "TND", on: "2026-08-13", now }),
    ).resolves.toBeNull();
  });

  it("returns null, without calling out, when no provider is configured", async () => {
    process.env.EXCHANGE_RATE_PROVIDER = "none";
    resetEnvCache();
    resetRatesProviderCache();
    const fetchMock = stubProvider(usdQuotes());

    await expect(
      lookupRate({ from: "USD", to: "EUR", on: "2026-08-13", now }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("isProviderQuotedRate", () => {
  it("recognizes a rate this instance fetched, and rejects a typed one", async () => {
    stubProvider(usdQuotes());
    await lookupRate({ from: "USD", to: "EUR", on: "2026-08-13", now });

    await expect(
      isProviderQuotedRate({
        from: "USD",
        to: "EUR",
        on: "2026-08-13",
        rate: "0.86618",
      }),
    ).resolves.toBe(true);

    await expect(
      isProviderQuotedRate({
        from: "USD",
        to: "EUR",
        on: "2026-08-13",
        rate: "0.9",
      }),
    ).resolves.toBe(false);
  });

  it("rejects a pair that was never fetched", async () => {
    await expect(
      isProviderQuotedRate({
        from: "GBP",
        to: "EUR",
        on: "2026-08-13",
        rate: "1.16",
      }),
    ).resolves.toBe(false);
  });
});

describe("refreshActiveRates", () => {
  it("warms today's rate for each pair a converted group is using", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, {
      currencyMode: "converted",
      baseCurrency: "EUR",
    });
    const db = getDb();
    await db.insert(expenses).values([
      {
        groupId: group.groupId,
        description: "Hotel",
        amount: 20000n,
        currency: "USD",
        splitMethod: "equal",
        expenseDate: "2026-08-10",
        createdByActorType: "user",
      },
      {
        groupId: group.groupId,
        description: "Old taxi",
        amount: 3000n,
        currency: "JPY",
        splitMethod: "equal",
        // Outside the 90-day window: not an active pair.
        expenseDate: "2025-01-10",
        createdByActorType: "user",
      },
    ]);

    const fetchMock = stubProvider(usdQuotes());
    const report = await refreshActiveRates({ now });

    expect(report).toEqual({ pairs: 1, fetched: 1, missing: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
