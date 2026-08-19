import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RateProviderError,
  createFrankfurterProvider,
  todayIso,
} from "./provider";

const provider = createFrankfurterProvider("https://rates.test/v2/");

/** One row as the v2 API returns it. */
function row(quote: string, rate: number, date = "2026-08-07") {
  return { date, base: "USD", quote, rate };
}

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

function lastUrl(): string {
  const mock = fetch as unknown as ReturnType<typeof vi.fn>;
  return mock.mock.calls[0][0] as string;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Frankfurter provider", () => {
  it("returns every quote in the response, keyed by currency", async () => {
    respondWith([row("EUR", 0.86693), row("JPY", 158.34), row("CHF", 0.81032)]);

    const quotes = await provider.fetchQuotes({
      base: "USD",
      on: "2026-08-07",
    });

    expect(quotes).not.toBeNull();
    expect(quotes?.provider).toBe("frankfurter");
    expect(quotes?.rates.get("EUR")?.rate).toBe("0.86693");
    expect(quotes?.rates.get("JPY")?.rate).toBe("158.34");
    expect(lastUrl()).toBe(
      "https://rates.test/v2/rates?base=USD&date=2026-08-07",
    );
  });

  it("prices the currencies v1 never could", async () => {
    // The bug this version exists for: v1 is the ECB's thirty currencies, so
    // AED and UAH — both offered by the picker — had no rate at all.
    respondWith([row("AED", 3.6725), row("UAH", 44.77632112)]);

    const quotes = await provider.fetchQuotes({
      base: "USD",
      on: "2026-08-07",
    });

    expect(quotes?.rates.get("AED")?.rate).toBe("3.6725");
    expect(quotes?.rates.get("UAH")?.rate).toBe("44.77632112");
  });

  it("keeps the day each pair was priced, which differs across one response", async () => {
    // Rates are blended across providers that do not publish on one schedule,
    // so a thinly traded pair rolls further back than a liquid one. A single
    // date for the whole response would misreport every row but the newest.
    respondWith([
      row("EUR", 0.86693, "2026-08-07"),
      row("MZN", 63.9, "2026-08-05"),
    ]);

    const quotes = await provider.fetchQuotes({
      base: "USD",
      on: "2026-08-07",
    });

    expect(quotes?.rates.get("EUR")?.quotedOn).toBe("2026-08-07");
    expect(quotes?.rates.get("MZN")?.quotedOn).toBe("2026-08-05");
  });

  it("reports the day actually priced, which is not always the day asked for", async () => {
    // A Saturday: rates roll back to Friday's fixing.
    respondWith([{ ...row("USD", 1.1545, "2026-08-07"), base: "EUR" }]);

    const quotes = await provider.fetchQuotes({
      base: "EUR",
      on: "2026-08-08",
    });

    expect(quotes?.rates.get("USD")?.quotedOn).toBe("2026-08-07");
  });

  it("asks for the latest fixing rather than a date in the future", async () => {
    // A future date answers with an empty list, not with the newest rate.
    respondWith([{ ...row("USD", 1.1545, todayIso()), base: "EUR" }]);

    await provider.fetchQuotes({ base: "EUR", on: "2099-01-01" });

    expect(lastUrl()).toBe("https://rates.test/v2/rates?base=EUR");
  });

  it("omits the date for today, whose fixing is the latest one", async () => {
    respondWith([{ ...row("USD", 1.1545, todayIso()), base: "EUR" }]);

    await provider.fetchQuotes({ base: "EUR", on: todayIso() });

    expect(lastUrl()).toBe("https://rates.test/v2/rates?base=EUR");
  });

  it("treats 404 as 'no data', not as a failure", async () => {
    respondWith({ status: 404, message: "not found" }, 404);

    await expect(
      provider.fetchQuotes({ base: "XXX", on: "2026-08-07" }),
    ).resolves.toBeNull();
  });

  it("treats 422 as 'no such currency', not as a failure", async () => {
    // v2 answers an unknown currency with 422 where v1 answered 404. Read as a
    // failure it would log an error on every lookup for a currency the
    // provider simply does not carry.
    respondWith({ status: 422, message: "invalid currency: XYZ" }, 422);

    await expect(
      provider.fetchQuotes({ base: "XYZ", on: "2026-08-07" }),
    ).resolves.toBeNull();
  });

  it("treats a date outside the provider's history as 'no data'", async () => {
    respondWith([]);

    await expect(
      provider.fetchQuotes({ base: "EUR", on: "1900-01-01" }),
    ).resolves.toBeNull();
  });

  it("raises on a server error", async () => {
    respondWith({ message: "boom" }, 502);

    await expect(
      provider.fetchQuotes({ base: "EUR", on: "2026-08-07" }),
    ).rejects.toThrow(RateProviderError);
  });

  it("raises when the payload is not shaped like a rate response", async () => {
    // Notably: a v1 root, whose object-of-rates is not a list of rows.
    respondWith({ base: "EUR", date: "2026-08-07", rates: { USD: 1.15 } });

    await expect(
      provider.fetchQuotes({ base: "EUR", on: "2026-08-07" }),
    ).rejects.toThrow(RateProviderError);
  });

  it("raises when the provider is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(
      provider.fetchQuotes({ base: "EUR", on: "2026-08-07" }),
    ).rejects.toThrow(RateProviderError);
  });

  it("drops nonsense entries and the base currency's own rate", async () => {
    respondWith([
      { ...row("USD", 1.1545), base: "EUR" },
      // v2 prices the base against itself at 1; it is not a quote.
      { ...row("EUR", 1), base: "EUR" },
      { ...row("BAD", 0), base: "EUR" },
      { ...row("lowercase", 2), base: "EUR" },
      { ...row("TOOLONGCODE", 3), base: "EUR" },
    ]);

    const quotes = await provider.fetchQuotes({
      base: "EUR",
      on: "2026-08-07",
    });

    expect([...(quotes?.rates.keys() ?? [])]).toEqual(["USD"]);
  });

  it("returns null when nothing usable survives", async () => {
    respondWith([{ ...row("EUR", 1), base: "EUR" }]);

    await expect(
      provider.fetchQuotes({ base: "EUR", on: "2026-08-07" }),
    ).resolves.toBeNull();
  });

  it("rejects a malformed date instead of building a bogus URL", async () => {
    respondWith([]);

    await expect(
      provider.fetchQuotes({ base: "EUR", on: "08/07/2026" }),
    ).rejects.toThrow(RateProviderError);
  });
});
