import { describe, expect, it } from "vitest";
import { money } from "@/modules/currencies/money";
import type { GroupSummary } from "@/modules/groups/service";
import {
  bucketPositions,
  directionOf,
  netPositionOf,
  perCurrencyTotals,
  resolveDisplayCurrency,
  type GroupPosition,
} from "./overview";

/**
 * The ranking and totalling behind the home screen.
 *
 * The conversion itself is not exercised here — it belongs to `rates.ts` and
 * its own tests. What matters at this level is that a missing rate is never
 * papered over: a total that cannot be computed comes back null rather than
 * short by one group.
 */

function group(overrides: Partial<GroupSummary> = {}): GroupSummary {
  return {
    id: crypto.randomUUID(),
    name: "Trip",
    description: null,
    icon: null,
    iconColor: null,
    currencyMode: "separate",
    baseCurrency: null,
    timezone: "UTC",
    archivedAt: null,
    role: "member",
    participantCount: 3,
    participantId: crypto.randomUUID(),
    lastActivityAt: new Date("2026-08-01T12:00:00Z"),
    memberNames: ["Sofia", "Mika"],
    ...overrides,
  };
}

function position(
  amounts: readonly ReturnType<typeof money>[],
  net: ReturnType<typeof money> | null,
  overrides: Partial<GroupSummary> = {},
): GroupPosition {
  return { group: group(overrides), amounts, net, owedTo: null };
}

describe("directionOf", () => {
  it("reads the sign of the converted net when there is one", () => {
    expect(
      directionOf(position([money(-500n, "CHF")], money(-460n, "EUR"))),
    ).toBe("owes");
    expect(
      directionOf(position([money(500n, "CHF")], money(460n, "EUR"))),
    ).toBe("owed");
  });

  it("treats a group with no balances as settled", () => {
    expect(directionOf(position([], money(0n, "EUR")))).toBe("settled");
  });

  it("falls back to the signs of the group's own amounts without a rate", () => {
    expect(directionOf(position([money(500n, "CHF")], null))).toBe("owed");
    expect(directionOf(position([money(-500n, "CHF")], null))).toBe("owes");
  });

  it("counts a group holding both a debt and a credit as owing", () => {
    const mixed = position([money(500n, "EUR"), money(-200n, "CHF")], null);
    expect(directionOf(mixed)).toBe("owes");
  });
});

describe("bucketPositions", () => {
  it("ranks by whether the group needs the user, largest first", () => {
    const small = position([money(-100n, "EUR")], money(-100n, "EUR"));
    const large = position([money(-900n, "EUR")], money(-900n, "EUR"));
    const owed = position([money(400n, "EUR")], money(400n, "EUR"));
    const settled = position([], money(0n, "EUR"));

    const buckets = bucketPositions([small, owed, settled, large]);

    expect(buckets.needsYou.map((p: GroupPosition) => p.net?.amount)).toEqual([
      -900n,
      -100n,
    ]);
    expect(buckets.youAreOwed).toHaveLength(1);
    expect(buckets.settled).toHaveLength(1);
    expect(buckets.archived).toHaveLength(0);
  });

  it("takes archived groups out of the ranked sections entirely", () => {
    const archived = position([money(-900n, "EUR")], money(-900n, "EUR"), {
      archivedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const buckets = bucketPositions([archived]);

    expect(buckets.needsYou).toHaveLength(0);
    expect(buckets.archived).toHaveLength(1);
  });

  it("orders settled groups by most recent activity", () => {
    const older = position([], money(0n, "EUR"), {
      name: "Older",
      lastActivityAt: new Date("2026-06-01T00:00:00Z"),
    });
    const newer = position([], money(0n, "EUR"), {
      name: "Newer",
      lastActivityAt: new Date("2026-08-01T00:00:00Z"),
    });

    expect(
      bucketPositions([older, newer]).settled.map((p) => p.group.name),
    ).toEqual(["Newer", "Older"]);
  });
});

describe("netPositionOf", () => {
  it("decomposes into what you are owed, what you owe, and the difference", () => {
    const result = netPositionOf(
      [
        position([money(56040n, "EUR")], money(56040n, "EUR")),
        position([money(-14780n, "EUR")], money(-14780n, "EUR")),
      ],
      "EUR",
    );

    expect(result).not.toBeNull();
    expect(result?.owedToYou.amount).toBe(56040n);
    expect(result?.youOwe.amount).toBe(14780n);
    expect(result?.net.amount).toBe(41260n);
    expect(result?.owedGroupCount).toBe(1);
    expect(result?.owingGroupCount).toBe(1);
  });

  it("returns null rather than a total missing a group it could not convert", () => {
    const result = netPositionOf(
      [
        position([money(56040n, "EUR")], money(56040n, "EUR")),
        position([money(-21000n, "CHF")], null),
      ],
      "EUR",
    );

    expect(result).toBeNull();
  });

  it("leaves archived groups out of the figure the list does not show", () => {
    const result = netPositionOf(
      [
        position([money(1000n, "EUR")], money(1000n, "EUR")),
        position([money(9999n, "EUR")], money(9999n, "EUR"), {
          archivedAt: new Date("2026-01-01T00:00:00Z"),
        }),
      ],
      "EUR",
    );

    expect(result?.net.amount).toBe(1000n);
  });

  it("is settled, not zero-owed, when everything nets out", () => {
    const result = netPositionOf(
      [
        position([money(500n, "EUR")], money(500n, "EUR")),
        position([money(-500n, "EUR")], money(-500n, "EUR")),
      ],
      "EUR",
    );

    expect(result?.net.amount).toBe(0n);
    expect(result?.owedGroupCount).toBe(1);
    expect(result?.owingGroupCount).toBe(1);
  });
});

describe("perCurrencyTotals", () => {
  it("keeps currencies apart instead of adding them together", () => {
    const totals = perCurrencyTotals([
      position([money(1000n, "EUR")], null),
      position([money(-400n, "EUR")], null),
      position([money(21000n, "CHF")], null),
    ]);

    expect(totals).toEqual([
      {
        currency: "CHF",
        owedToYou: money(21000n, "CHF"),
        youOwe: money(0n, "CHF"),
      },
      {
        currency: "EUR",
        owedToYou: money(1000n, "EUR"),
        youOwe: money(400n, "EUR"),
      },
    ]);
  });
});

describe("resolveDisplayCurrency", () => {
  it("honours a stated preference", () => {
    expect(
      resolveDisplayCurrency("USD", [position([money(100n, "EUR")], null)]),
    ).toBe("USD");
  });

  it("ignores a preference that is not a currency", () => {
    expect(
      resolveDisplayCurrency("XXXX", [position([money(100n, "EUR")], null)]),
    ).toBe("EUR");
  });

  it("falls back to the currency the user's groups balance in most often", () => {
    const currency = resolveDisplayCurrency(null, [
      position([money(100n, "CHF")], null),
      position([money(100n, "EUR")], null),
      position([money(100n, "EUR")], null),
    ]);

    expect(currency).toBe("EUR");
  });

  it("has nothing to total in when no group holds a balance", () => {
    expect(resolveDisplayCurrency(null, [position([], null)])).toBeNull();
  });
});
