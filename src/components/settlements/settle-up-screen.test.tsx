import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import {
  SettleUpScreen,
  initialsOf,
  type SettleUpCurrencyView,
  type SettleUpTransferView,
} from "./settle-up-screen";
import type { RemindRecipient } from "@/modules/reminders/types";

/*
 * The record dialog behind every row refreshes the page once it has saved, so
 * it reaches for the app router. There is none in jsdom, and nothing here
 * asserts on navigation — the dialog has its own tests.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

/**
 * What this screen must never do is mislead somebody about what they owe: no
 * currency added to another, no zero dressed up as a balance, no direction
 * carried by colour alone, and no way to chase a debt that is not yours.
 */

function transfer(
  overrides: Partial<SettleUpTransferView> = {},
): SettleUpTransferView {
  return {
    fromParticipantId: "seb",
    fromName: "Seb",
    toParticipantId: "amelie",
    toName: "Amélie",
    currency: "EUR",
    minorUnits: "14860",
    fromIsSelf: true,
    toIsSelf: false,
    ...overrides,
  };
}

function recipient(overrides: Partial<RemindRecipient> = {}): RemindRecipient {
  return {
    participantId: "ravi",
    name: "Ravi",
    debts: [{ amount: "6200", currency: "CHF" }],
    channel: "push",
    lastRemindedAt: null,
    locked: false,
    muted: false,
    ...overrides,
  };
}

const PARTICIPANTS = [
  { id: "seb", displayName: "Seb" },
  { id: "amelie", displayName: "Amélie" },
  { id: "ravi", displayName: "Ravi" },
];

function render(
  props: Partial<Parameters<typeof SettleUpScreen>[0]> = {},
  currencies: readonly SettleUpCurrencyView[] = [
    { currency: "EUR", yours: [transfer()], others: [] },
  ],
) {
  const count = currencies.reduce(
    (total, entry) => total + entry.yours.length + entry.others.length,
    0,
  );
  return renderWithIntl(
    <SettleUpScreen
      currencies={currencies}
      transferCount={count}
      lastSettled={[]}
      participantCount={5}
      groupId="g1"
      groupName="Lisbon trip"
      senderName="Seb"
      recipients={[]}
      participants={PARTICIPANTS}
      currencyMode="separate"
      baseCurrency={null}
      {...props}
    />,
  );
}

describe("the transfers", () => {
  it("writes each one as a sentence with its amount", () => {
    render();

    expect(screen.getByText("Seb pays Amélie")).toBeInTheDocument();
    expect(screen.getByText("EUR 148.60")).toBeInTheDocument();
  });

  it("keeps every currency in its own card and never totals them", () => {
    render({}, [
      { currency: "EUR", yours: [transfer()], others: [] },
      {
        currency: "CHF",
        yours: [
          transfer({
            fromParticipantId: "ravi",
            fromName: "Ravi",
            toParticipantId: "seb",
            toName: "Seb",
            currency: "CHF",
            minorUnits: "6200",
            fromIsSelf: false,
            toIsSelf: true,
          }),
        ],
        others: [],
      },
    ]);

    expect(screen.getByText("EUR")).toBeInTheDocument();
    expect(screen.getByText("CHF")).toBeInTheDocument();
    expect(screen.getByText("EUR 148.60")).toBeInTheDocument();
    expect(screen.getByText("CHF 62.00")).toBeInTheDocument();
  });

  it("says a settled currency in words rather than showing 0.00", () => {
    render({}, [
      { currency: "EUR", yours: [transfer()], others: [] },
      { currency: "GBP", yours: [], others: [] },
    ]);

    expect(screen.getByText("Settled up")).toBeInTheDocument();
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
  });

  it("labels the two groups only when both have something in them", () => {
    render({}, [
      {
        currency: "EUR",
        yours: [transfer()],
        others: [
          transfer({
            fromParticipantId: "ravi",
            fromName: "Ravi",
            toParticipantId: "lena",
            toName: "Lena",
            minorUnits: "9940",
            fromIsSelf: false,
            toIsSelf: false,
          }),
        ],
      },
    ]);

    expect(screen.getByText("Your payments")).toBeInTheDocument();
    expect(screen.getByText("Between others")).toBeInTheDocument();
  });

  it("leaves the labels off a card holding only one group", () => {
    render();

    expect(screen.queryByText("Your payments")).not.toBeInTheDocument();
    expect(screen.queryByText("Between others")).not.toBeInTheDocument();
  });
});

describe("the actions on a row", () => {
  it("offers recording on the debt the reader owes", () => {
    render();

    expect(
      screen.getByRole("button", { name: "Record Seb's payment to Amélie" }),
    ).toBeInTheDocument();
  });

  it("offers chasing a debt owed to the reader", () => {
    render({ recipients: [recipient()] }, [
      {
        currency: "CHF",
        yours: [
          transfer({
            fromParticipantId: "ravi",
            fromName: "Ravi",
            toParticipantId: "seb",
            toName: "Seb",
            currency: "CHF",
            minorUnits: "6200",
            fromIsSelf: false,
            toIsSelf: true,
          }),
        ],
        others: [],
      },
    ]);

    expect(
      screen.getByRole("button", { name: /remind ravi/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record Ravi's payment to Seb" }),
    ).toBeInTheDocument();
  });

  it("never offers to chase a debt between two other people", () => {
    render(
      // A recipient list that does name Ravi — the row is still not the
      // reader's to chase, because the money is not coming to them.
      { recipients: [recipient()] },
      [
        {
          currency: "EUR",
          yours: [],
          others: [
            transfer({
              fromParticipantId: "ravi",
              fromName: "Ravi",
              toParticipantId: "lena",
              toName: "Lena",
              minorUnits: "9940",
              fromIsSelf: false,
              toIsSelf: false,
            }),
          ],
        },
      ],
    );

    expect(screen.queryByRole("button", { name: /remind/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Record Ravi's payment to Lena" }),
    ).toBeInTheDocument();
  });

  it("says when the person was last chased", () => {
    render(
      {
        recipients: [recipient({ lastRemindedAt: new Date().toISOString() })],
      },
      [
        {
          currency: "CHF",
          yours: [
            transfer({
              fromParticipantId: "ravi",
              fromName: "Ravi",
              toParticipantId: "seb",
              toName: "Seb",
              currency: "CHF",
              minorUnits: "6200",
              fromIsSelf: false,
              toIsSelf: true,
            }),
          ],
          others: [],
        },
      ],
    );

    expect(screen.getByText(/^Reminded /)).toBeInTheDocument();
  });
});

describe("the header", () => {
  it("counts the people in a group that balances per currency", () => {
    render();

    expect(screen.getByText("Lisbon trip · 5 people")).toBeInTheDocument();
  });

  it("names the settlement currency in a converted group", () => {
    render({ currencyMode: "converted", baseCurrency: "CHF" });

    expect(
      screen.getByText("Lisbon trip · settles in CHF"),
    ).toBeInTheDocument();
  });

  it("counts the whole plan once when the group settles in one currency", () => {
    render({ currencyMode: "converted", baseCurrency: "CHF" }, [
      {
        currency: "CHF",
        yours: [transfer({ currency: "CHF" })],
        others: [
          transfer({
            fromParticipantId: "ravi",
            fromName: "Ravi",
            toParticipantId: "lena",
            toName: "Lena",
            currency: "CHF",
            minorUnits: "9940",
            fromIsSelf: false,
            toIsSelf: false,
          }),
        ],
      },
    ]);

    expect(
      screen.getByRole("heading", { name: "2 payments clear the group" }),
    ).toBeInTheDocument();
  });

  it("counts each currency separately when they are balanced apart", () => {
    render({}, [
      {
        currency: "EUR",
        yours: [transfer()],
        others: [
          transfer({
            fromParticipantId: "ravi",
            fromName: "Ravi",
            toParticipantId: "lena",
            toName: "Lena",
            minorUnits: "9940",
            fromIsSelf: false,
            toIsSelf: false,
          }),
        ],
      },
    ]);

    expect(
      screen.getByText("2 payments clear this currency"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/clear the group/)).toBeNull();
  });

  it("goes back to the group", () => {
    render();

    expect(screen.getByRole("link", { name: /back/i })).toHaveAttribute(
      "href",
      "/groups/g1",
    );
  });
});

describe("nothing to settle", () => {
  it("says so, and names what cleared it", () => {
    render(
      {
        transferCount: 0,
        lastSettled: [
          {
            id: "s1",
            fromName: "Ravi",
            toName: "Seb",
            currency: "CHF",
            minorUnits: "6200",
            settledOn: "2026-08-22",
            paymentMethod: "Wero",
          },
        ],
      },
      [],
    );

    expect(screen.getByText("Everyone is settled up")).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(within(list).getByText("Ravi paid Seb")).toBeInTheDocument();
    expect(within(list).getByText(/Wero/)).toBeInTheDocument();
    expect(within(list).getByText("CHF 62.00")).toBeInTheDocument();
  });

  it("leaves the method out when none was recorded", () => {
    render(
      {
        transferCount: 0,
        lastSettled: [
          {
            id: "s1",
            fromName: "Ravi",
            toName: "Seb",
            currency: "CHF",
            minorUnits: "6200",
            settledOn: "2026-08-22",
            paymentMethod: null,
          },
        ],
      },
      [],
    );

    const list = screen.getByRole("list");
    expect(within(list).queryByText(/·/)).not.toBeInTheDocument();
  });

  it("offers the way back and nothing to record", () => {
    render({ transferCount: 0, lastSettled: [] }, []);

    expect(
      screen.getByRole("link", { name: "Back to the group" }),
    ).toHaveAttribute("href", "/groups/g1");
    expect(screen.queryByRole("button", { name: /record/i })).toBeNull();
  });
});

describe("initials", () => {
  it("takes both, from a name that has two words", () => {
    expect(initialsOf("Amélie Marchand")).toBe("AM");
  });

  it("takes one from a single-word name, as the rest of the app does", () => {
    expect(initialsOf("Ravi")).toBe("R");
  });

  it("survives the padding people leave in a display name", () => {
    expect(initialsOf("  lena  koch  ")).toBe("LK");
  });
});
