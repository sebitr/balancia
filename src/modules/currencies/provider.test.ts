import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RateProviderError,
  createFrankfurterProvider,
  todayIso,
} from "./provider";

const provider = createFrankfurterProvider("https://rates.test/v1/");

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
    respondWith({
      amount: 1,
      base: "USD",
      date: "2026-08-07",
      rates: { EUR: 0.86693, JPY: 158.34, CHF: 0.81032 },
    });

    const quotes = await provider.fetchQuotes({
      base: "USD",
      on: "2026-08-07",
    });

    expect(quotes).not.toBeNull();
    expect(quotes?.provider).toBe("frankfurter");
    expect(quotes?.quotedOn).toBe("2026-08-07");
    expect(quotes?.rates.get("EUR")).toBe("0.86693");
    expect(quotes?.rates.get("JPY")).toBe("158.34");
    expect(lastUrl()).toBe("https://rates.test/v1/2026-08-07?base=USD");
  });

  it("reports the day actually priced, which is not always the day asked for", async () => {
    // A Saturday: reference rates roll back to Friday's fixing.
    respondWith({
      amount: 1,
      base: "EUR",
      date: "2026-08-07",
      rates: { USD: 1.1545 },
    });

    const quotes = await provider.fetchQuotes({
      base: "EUR",
      on: "2026-08-08",
    });

    expect(quotes?.quotedOn).toBe("2026-08-07");
  });

  it("asks for the latest fixing rather than a date in the future", async () => {
    respondWith({
      amount: 1,
      base: "EUR",
      date: todayIso(),
      rates: { USD: 1.1545 },
    });

    await provider.fetchQuotes({ base: "EUR", on: "2099-01-01" });

    expect(lastUrl()).toBe("https://rates.test/v1/latest?base=EUR");
  });

  it("treats 404 as 'no data', not as a failure", async () => {
    respondWith({ message: "not found" }, 404);

    await expect(
      provider.fetchQuotes({ base: "XXX", on: "2026-08-07" }),
    ).resolves.toBeNull();
  });

  it("raises on a server error", async () => {
    respondWith({ message: "boom" }, 502);

    await expect(
      provider.fetchQuotes({ base: "EUR", on: "2026-08-07" }),
    ).rejects.toThrow(RateProviderError);
  });

  it("raises when the payload is not shaped like a rate response", async () => {
    respondWith({ base: "EUR", date: "nope", rates: { USD: "1.15" } });

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
    respondWith({
      amount: 1,
      base: "EUR",
      date: "2026-08-07",
      rates: { USD: 1.1545, EUR: 1, BAD: 0, lowercase: 2, TOOLONGCODE: 3 },
    });

    const quotes = await provider.fetchQuotes({
      base: "EUR",
      on: "2026-08-07",
    });

    expect([...(quotes?.rates.keys() ?? [])]).toEqual(["USD"]);
  });

  it("returns null when nothing usable survives", async () => {
    respondWith({ amount: 1, base: "EUR", date: "2026-08-07", rates: {} });

    await expect(
      provider.fetchQuotes({ base: "EUR", on: "2026-08-07" }),
    ).resolves.toBeNull();
  });

  it("rejects a malformed date instead of building a bogus URL", async () => {
    respondWith({ amount: 1, base: "EUR", date: "2026-08-07", rates: {} });

    await expect(
      provider.fetchQuotes({ base: "EUR", on: "08/07/2026" }),
    ).rejects.toThrow(RateProviderError);
  });
});
