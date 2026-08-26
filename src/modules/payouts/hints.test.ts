import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettleUpView } from "@/modules/settlements/settle-up";
import type { PayoutAddressView, PayoutMethodView } from "./service";

/**
 * How a debt is turned into a way to pay it.
 *
 * The database half is mocked: what is worth pinning here is which debts get a
 * hint and what goes in it, and both are decided before a query runs. The
 * queries themselves are the service's own to test, and the rule they enforce
 * — that a recipient is reachable only through a debt — is expressed here as
 * the ids this module asks for.
 */

const listPayoutsOwed = vi.fn();
const listPayoutAddressesOwed = vi.fn();

vi.mock("./service", () => ({
  listPayoutsOwed: (...args: unknown[]) => listPayoutsOwed(...args),
  listPayoutAddressesOwed: (...args: unknown[]) =>
    listPayoutAddressesOwed(...args),
}));

const { buildPayoutHints } = await import("./hints");

const SWISS_ADDRESS: PayoutAddressView = {
  street: "Rue du Rhône",
  buildingNumber: "12",
  postalCode: "1204",
  town: "Genève",
  country: "CH",
};

function transfer(
  from: string,
  to: string,
  amount: bigint,
  currency: string,
  fromIsSelf: boolean,
) {
  return {
    fromParticipantId: from,
    fromName: from,
    toParticipantId: to,
    toName: to,
    currency,
    amount,
    fromIsSelf,
    toIsSelf: false,
  };
}

function view(
  ...currencies: { currency: string; yours: ReturnType<typeof transfer>[] }[]
): SettleUpView {
  return {
    currencies: currencies.map((entry) => ({
      currency: entry.currency,
      yours: entry.yours,
      others: [],
      settled: false,
    })),
    transferCount: currencies.reduce((n, e) => n + e.yours.length, 0),
    lastSettled: [],
  } as unknown as SettleUpView;
}

function owed(methods: Record<string, PayoutMethodView[]>) {
  listPayoutsOwed.mockResolvedValue(new Map(Object.entries(methods)));
}

beforeEach(() => {
  vi.clearAllMocks();
  listPayoutsOwed.mockResolvedValue(new Map());
  listPayoutAddressesOwed.mockResolvedValue(new Map());
});

describe("which debts get a hint", () => {
  it("asks only about the people the reader owes", async () => {
    await buildPayoutHints(
      "group",
      "Lisbon",
      view({
        currency: "EUR",
        yours: [
          transfer("me", "ada", 500n, "EUR", true),
          // Somebody else's debt, on the same screen and none of my business.
          transfer("nils", "ada", 900n, "EUR", false),
        ],
      }),
    );

    expect(listPayoutsOwed).toHaveBeenCalledWith("group", ["ada"], {});
  });

  it("asks nothing at all when the reader owes nothing", async () => {
    const hints = await buildPayoutHints(
      "group",
      "Lisbon",
      view({
        currency: "EUR",
        yours: [transfer("nils", "ada", 900n, "EUR", false)],
      }),
    );

    expect(hints).toEqual([]);
    expect(listPayoutsOwed).not.toHaveBeenCalled();
  });

  it("leaves out a recipient who has said nothing about how to be paid", async () => {
    owed({});
    const hints = await buildPayoutHints(
      "group",
      "Lisbon",
      view({
        currency: "EUR",
        yours: [transfer("me", "ada", 500n, "EUR", true)],
      }),
    );

    expect(hints).toEqual([]);
  });

  it("gives one hint per debt, not one per person", async () => {
    owed({ ada: [{ method: "twint", detail: "+41 79 000 00 00" }] });
    const hints = await buildPayoutHints(
      "group",
      "Lisbon",
      view(
        {
          currency: "EUR",
          yours: [transfer("me", "ada", 500n, "EUR", true)],
        },
        {
          currency: "CHF",
          yours: [transfer("me", "ada", 900n, "CHF", true)],
        },
      ),
    );

    // The same person, owed twice: two rows on the screen, two hints.
    expect(hints.map((hint) => hint.currency)).toEqual(["EUR", "CHF"]);
    expect(new Set(hints.map((hint) => hint.participantId))).toEqual(
      new Set(["ada"]),
    );
  });
});

describe("what goes in a hint", () => {
  it("keeps every method, in the owner's order", async () => {
    owed({
      ada: [
        { method: "twint", detail: "+41 79 000 00 00" },
        { method: "paypal", detail: "ada@example.com" },
      ],
    });
    const [hint] = await buildPayoutHints(
      "group",
      "Lisbon",
      view({
        currency: "EUR",
        yours: [transfer("me", "ada", 500n, "EUR", true)],
      }),
    );

    expect(hint.methods.map((entry) => entry.method)).toEqual([
      "twint",
      "paypal",
    ]);
  });

  it("finds the bank entry by name rather than off the top of the list", async () => {
    owed({
      ada: [
        { method: "twint", detail: "+41 79 000 00 00" },
        { method: "bank", detail: "DE89 3704 0044 0532 0130 00" },
      ],
    });
    const [hint] = await buildPayoutHints(
      "group",
      "Lisbon",
      view({
        currency: "EUR",
        yours: [transfer("me", "ada", 500n, "EUR", true)],
      }),
    );

    // Preferring TWINT is a preference, not the absence of an account.
    expect(hint.qr?.standard).toBe("epc");
  });

  it("builds no code for a recipient with no bank entry, and blames nobody", async () => {
    owed({ ada: [{ method: "twint", detail: "+41 79 000 00 00" }] });
    const [hint] = await buildPayoutHints(
      "group",
      "Lisbon",
      view({
        currency: "EUR",
        yours: [transfer("me", "ada", 500n, "EUR", true)],
      }),
    );

    expect(hint.qr).toBeNull();
    expect(hint.qrMissing).toBeNull();
  });

  it("says an address is missing, because that is something to go and fix", async () => {
    owed({ ada: [{ method: "bank", detail: "CH93 0076 2011 6238 5295 7" }] });
    const [hint] = await buildPayoutHints(
      "group",
      "Lisbon",
      view({
        currency: "CHF",
        yours: [transfer("me", "ada", 900n, "CHF", true)],
      }),
    );

    expect(hint.qr).toBeNull();
    expect(hint.qrMissing).toBe("addressMissing");
  });

  it("builds the Swiss code once the address is on file", async () => {
    owed({ ada: [{ method: "bank", detail: "CH93 0076 2011 6238 5295 7" }] });
    listPayoutAddressesOwed.mockResolvedValue(
      new Map([["ada", SWISS_ADDRESS]]),
    );
    const [hint] = await buildPayoutHints(
      "group",
      "Lisbon",
      view({
        currency: "CHF",
        yours: [transfer("me", "ada", 900n, "CHF", true)],
      }),
    );

    expect(hint.qr?.standard).toBe("swiss");
    expect(hint.qrMissing).toBeNull();
    // The amount is the row's own, so a code can never name a figure that is
    // not on screen beside it.
    expect(hint.qr?.payload).toContain("9.00");
  });
});
