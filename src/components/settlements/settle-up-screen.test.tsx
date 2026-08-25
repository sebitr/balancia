import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import {
  SettleUpScreen,
  initialsOf,
  type SettleUpCurrencyView,
  type SettleUpTransferView,
} from "./settle-up-screen";
import type { RemindRecipient } from "@/modules/reminders/types";

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
      currencyMode="separate"
      baseCurrency={null}
      payoutHints={[]}
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
  it("opens the add-entry drawer on the debt the reader owes", () => {
    render();

    expect(
      screen.getByRole("link", { name: "Record Seb's payment to Amélie" }),
    ).toHaveAttribute(
      "href",
      "/groups/g1/expenses/new?settleFrom=seb&settleTo=amelie&settleIn=EUR",
    );
  });

  it("leaves the amount off the link, so the drawer prices it itself", () => {
    render();

    const href = screen
      .getByRole("link", { name: /^Record/ })
      .getAttribute("href");

    expect(href).not.toContain("14860");
    expect(href).not.toContain("148.60");
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
      screen.getByRole("link", { name: "Record Ravi's payment to Seb" }),
    ).toHaveAttribute(
      "href",
      "/groups/g1/expenses/new?settleFrom=ravi&settleTo=seb&settleIn=CHF",
    );
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
      screen.getByRole("link", { name: "Record Ravi's payment to Lena" }),
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
    expect(screen.queryByRole("link", { name: /record/i })).toBeNull();
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

/**
 * Where to send it.
 *
 * The hint is shown on the rows the reader is paying and nowhere else — not
 * because the other rows would be uninteresting, but because a payout detail
 * is readable by the people who owe its owner money and by nobody else, and
 * this screen is the only place that decides which rows those are.
 *
 * All of them, in the owner's order. Showing only their first was a guess
 * about the *payer* — that whatever the payee prefers is a thing the payer can
 * use — and it is wrong exactly when it matters, which is somebody holding a
 * TWINT number they have no way to pay.
 */
describe("payout details", () => {
  const hint = {
    participantId: "amelie",
    currency: "EUR",
    methods: [
      { method: "twint", detail: "+41791234567" },
      { method: "revolut", detail: "@amelie" },
      { method: "cash", detail: "" },
    ],
    qr: null,
    qrMissing: null,
  };

  it("names every way the person being paid accepts money", () => {
    render({ payoutHints: [hint] });

    expect(screen.getByText("How to pay Amélie")).toBeInTheDocument();
    for (const label of ["TWINT", "Revolut", "Cash"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(label) }),
      ).toBeInTheDocument();
    }
  });

  it("opens on the one its owner put first, and says that is why", () => {
    render({ payoutHints: [hint] });

    expect(screen.getByRole("button", { name: /TWINT/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Preferred")).toBeInTheDocument();
    expect(screen.getByText("+41791234567")).toBeInTheDocument();
  });

  it("marks nothing preferred when there is only one", () => {
    render({ payoutHints: [{ ...hint, methods: [hint.methods[0]] }] });

    expect(screen.queryByText("Preferred")).toBeNull();
  });

  it("swaps the detail for the one the reader taps", async () => {
    const user = userEvent.setup();
    render({ payoutHints: [hint] });

    await user.click(screen.getByRole("button", { name: /Revolut/ }));

    expect(screen.getByText("@amelie")).toBeInTheDocument();
    expect(screen.queryByText("+41791234567")).toBeNull();
  });

  it("offers to copy the detail rather than have it transcribed", () => {
    render({ payoutHints: [hint] });
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("says there is nothing to copy for cash, and names the sum", async () => {
    const user = userEvent.setup();
    render({ payoutHints: [hint] });

    await user.click(screen.getByRole("button", { name: /Cash/ }));

    expect(
      screen.getByText("Nothing to copy — hand them the EUR 148.60."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });

  it("shows nothing on a row the reader is not the one paying", () => {
    // The reader is the one paying here, so a hint for *them* is a hint for
    // the wrong side of the row.
    render({ payoutHints: [{ ...hint, participantId: "seb" }] });
    expect(screen.queryByText(/How to pay/)).toBeNull();
  });

  it("shows nothing when the person has not said", () => {
    render({ payoutHints: [] });
    expect(screen.queryByText(/How to pay/)).toBeNull();
  });
});

/**
 * What the reader picked, carried into the drawer that records the payment.
 *
 * The screen already knows how they paid — they chose it a moment ago, on the
 * row they are about to tap — so the form should not open and ask again.
 */
describe("the method on the record link", () => {
  const hint = {
    participantId: "amelie",
    currency: "EUR",
    methods: [
      { method: "twint", detail: "+41791234567" },
      { method: "revolut", detail: "@amelie" },
    ],
    qr: null,
    qrMissing: null,
  };

  it("names the chip the row opened on", () => {
    render({ payoutHints: [hint] });

    expect(
      screen.getByRole("link", { name: "Record Seb's payment to Amélie" }),
    ).toHaveAttribute("href", expect.stringContaining("settleVia=twint"));
  });

  it("follows the reader to another chip", async () => {
    const user = userEvent.setup();
    render({ payoutHints: [hint] });

    await user.click(screen.getByRole("button", { name: /Revolut/ }));

    expect(
      screen.getByRole("link", { name: "Record Seb's payment to Amélie" }),
    ).toHaveAttribute("href", expect.stringContaining("settleVia=revolut"));
  });

  it("names none where the payee listed none", () => {
    render({ payoutHints: [] });

    expect(
      screen
        .getByRole("link", { name: "Record Seb's payment to Amélie" })
        .getAttribute("href"),
    ).not.toContain("settleVia");
  });
});

/**
 * The payment code, which is behind a tap.
 *
 * A settle screen four QR codes tall is one nobody reads, so each row offers
 * its own and none of them opens by itself.
 */
describe("the payment code", () => {
  const withQr = {
    participantId: "amelie",
    currency: "EUR",
    methods: [{ method: "bank", detail: "CH9300762011623852957" }],
    qr: {
      standard: "swiss" as const,
      payload: ["SPC", "0200", "1", "CH9300762011623852957"].join("\n"),
    },
    qrMissing: null,
  };

  it("offers it without showing it", () => {
    render({ payoutHints: [withQr] });

    expect(
      screen.getByRole("button", { name: "Show QR code" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Scan to pay" })).toBeNull();
  });

  it("draws it when asked, and says which standard it is", async () => {
    const user = userEvent.setup();
    render({ payoutHints: [withQr] });

    await user.click(screen.getByRole("button", { name: "Show QR code" }));

    expect(
      screen.getByRole("img", { name: "Scan to pay" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Swiss QR-bill/)).toBeInTheDocument();
    expect(screen.getByText("EUR 148.60 to Amélie")).toBeInTheDocument();
  });

  it("is built from the account, whichever chip the payee put first", async () => {
    // The order is the owner's preference and the code is a fact about their
    // bank: a TWINT-first list still has an IBAN a banking app can pay into,
    // and the code used to be built from whatever sat at the top of that list.
    const user = userEvent.setup();
    render({
      payoutHints: [
        {
          ...withQr,
          methods: [
            { method: "twint", detail: "+41791234567" },
            { method: "bank", detail: "CH9300762011623852957" },
          ],
        },
      ],
    });

    // Not under TWINT, which is where the row opens — a phone number is not
    // something a banking app scans.
    expect(screen.queryByRole("button", { name: "Show QR code" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Bank transfer/ }));

    expect(
      screen.getByRole("button", { name: "Show QR code" }),
    ).toBeInTheDocument();
  });

  it("offers nothing where no standard could carry the payment", () => {
    // A TWINT number is not something a banking app scans, and a Swiss account
    // with no address on file cannot have a code built for it at all.
    render({
      payoutHints: [
        {
          ...withQr,
          methods: [{ method: "twint", detail: "+41791234567" }],
          qr: null,
        },
      ],
    });
    expect(screen.queryByRole("button", { name: /QR code/ })).toBeNull();
  });

  it("belongs to one debt, not to one person", () => {
    // The same creditor in two currencies is two payments. Before the hint
    // carried a currency, both rows found the first hint and showed one
    // amount's code twice.
    render(
      {
        payoutHints: [
          withQr,
          { ...withQr, currency: "CHF", qr: null, qrMissing: "currency" },
        ],
      },
      [
        { currency: "EUR", yours: [transfer()], others: [] },
        {
          currency: "CHF",
          yours: [transfer({ currency: "CHF", minorUnits: "6200" })],
          others: [],
        },
      ],
    );

    // One row offers the code; the other says why it has none.
    expect(
      screen.getAllByRole("button", { name: "Show QR code" }),
    ).toHaveLength(1);
    expect(screen.getByText(/cannot carry CHF/)).toBeInTheDocument();
  });
});

/**
 * Why there is no code, on the rows that have none.
 *
 * The reasons are told to somebody who was expecting a code and did not get
 * one. None of them is their mistake, and only the ones with an answer are
 * said out loud — the server sends null for the rest rather than a sentence
 * whose reply is "nothing".
 */
describe("when there is no payment code", () => {
  const noQr = {
    participantId: "amelie",
    currency: "EUR",
    methods: [{ method: "bank", detail: "CH9300762011623852957" }],
    qr: null,
  };

  it("names the address the QR-bill standard is missing", () => {
    render({ payoutHints: [{ ...noQr, qrMissing: "addressMissing" }] });

    expect(screen.getByText(/Amélie has a Swiss account/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /QR code/ })).toBeNull();
  });

  it("explains a QR-IBAN in terms of the bank rather than the format", () => {
    render({ payoutHints: [{ ...noQr, qrMissing: "qrIban" }] });

    expect(screen.getByText(/invoice references/)).toBeInTheDocument();
  });

  it("names the currency no standard carries", () => {
    render({ payoutHints: [{ ...noQr, qrMissing: "currency" }] });

    expect(screen.getByText(/cannot carry EUR/)).toBeInTheDocument();
  });

  it("says nothing at all when the reason is not one to act on", () => {
    // A TWINT number has no code and needs no explanation: nobody expected a
    // banking app to scan a phone number.
    render({
      payoutHints: [
        {
          ...noQr,
          methods: [{ method: "twint", detail: "+41791234567" }],
          qrMissing: null,
        },
      ],
    });

    expect(screen.queryByText(/Swiss account/)).toBeNull();
    expect(screen.queryByText(/cannot carry/)).toBeNull();
  });

  it("keeps the reason under the account it is about", async () => {
    // "No address on file" answers a question about the bank transfer. Under
    // the TWINT chip it is a sentence about something the reader is not
    // looking at.
    const user = userEvent.setup();
    render({
      payoutHints: [
        {
          ...noQr,
          methods: [
            { method: "bank", detail: "CH9300762011623852957" },
            { method: "twint", detail: "+41791234567" },
          ],
          qrMissing: "addressMissing",
        },
      ],
    });

    expect(screen.getByText(/Swiss account/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /TWINT/ }));

    expect(screen.queryByText(/Swiss account/)).toBeNull();
  });

  it("still gives the detail to copy", () => {
    render({ payoutHints: [{ ...noQr, qrMissing: "addressMissing" }] });

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});
