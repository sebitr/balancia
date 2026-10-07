import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { AppLocale } from "@/i18n/locales";
import type { EntryParties } from "./stake";
import { BigAmount } from "./detail-blocks";
import { SplitCard, SplitTable, YourStake } from "./stake-blocks";

/**
 * The expense detail, as each person in an expense reads it.
 *
 * It used to open on the total in the "you owe" red with a minus in front of
 * it, for everybody — the person who paid for the table included — and to
 * state each person's part only as a signed figure in a column a phone
 * clipped, with the words for it hidden from sight. Now the total is plain,
 * the line under it speaks to the reader, and every row says in words what
 * the entry did to that person.
 *
 * Both blocks render on the server; here they are awaited against the real
 * catalogue in either language and their output mounted.
 */

const intl = vi.hoisted(() => ({ locale: "en" as AppLocale }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale: intl.locale,
      messages: intl.locale === "fr" ? fr : en,
      namespace: namespace as never,
    }),
}));

beforeEach(() => {
  intl.locale = "en";
});

const party = (participantId: string, amount: bigint, name: string) => ({
  participantId,
  displayName: name,
  amount,
});

/** Ada pays €90.00 for the three of them. */
const DINNER: EntryParties = {
  direction: "out",
  payers: [party("ada", 9000n, "Ada")],
  shares: [
    party("ada", 3000n, "Ada"),
    party("bob", 3000n, "Bob"),
    party("chloe", 3000n, "Chloé"),
  ],
};

/** Ada was handed a €90.00 refund that belongs to all three. */
const REFUND: EntryParties = { ...DINNER, direction: "in" };

async function stake(
  entry: EntryParties,
  participantId: string | null,
  options: { currency?: string; locale?: AppLocale } = {},
) {
  const locale = options.locale ?? "en";
  intl.locale = locale;
  return renderWithIntl(
    await YourStake({
      entry,
      participantId,
      currency: options.currency ?? "EUR",
      locale,
    }),
    { locale },
  );
}

async function split(
  entry: EntryParties,
  participantId: string | null,
  options: { locale?: AppLocale } = {},
) {
  const locale = options.locale ?? "en";
  intl.locale = locale;
  return renderWithIntl(
    await SplitCard({ entry, participantId, currency: "EUR", locale }),
    { locale },
  );
}

/** Intl spaces a French figure with a narrow no-break space; read it as one. */
const plain = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("the total", () => {
  it("carries no sign and no money colour, whoever is reading", () => {
    const { container } = renderWithIntl(
      <BigAmount minorUnits="9000" currency="EUR" locale="en" />,
    );

    expect(plain(container.textContent)).toBe("EUR90.00");
    expect(container.innerHTML).not.toMatch(/negative|positive/);
  });
});

describe("your line under the total", () => {
  it("tells the payer who is owed what comes back to them, in green", async () => {
    const { container } = await stake(DINNER, "ada");

    expect(container).toHaveTextContent(
      "You paid €90.00 · you get back €60.00",
    );
    expect(screen.getByText("you get back €60.00")).toHaveClass(
      "text-positive-ink",
    );
  });

  it("tells somebody with a share who paid and what they owe, in red", async () => {
    const { container } = await stake(DINNER, "bob");

    expect(container).toHaveTextContent("Ada paid · you owe €30.00");
    expect(screen.getByText("you owe €30.00")).toHaveClass("text-negative-ink");
    // Only the half that has a direction is coloured.
    expect(screen.getByText(/^Ada paid/)).not.toHaveClass("text-negative-ink");
  });

  it("counts the payers when there were several and the reader was not one", async () => {
    const entry: EntryParties = {
      ...DINNER,
      payers: [party("ada", 6000n, "Ada"), party("bob", 3000n, "Bob")],
    };
    const { container } = await stake(entry, "chloe");

    expect(container).toHaveTextContent("2 people paid · you owe €30.00");
  });

  it("lets a part-payer on a multi-payer entry still owe", async () => {
    const entry: EntryParties = {
      ...DINNER,
      payers: [party("ada", 7000n, "Ada"), party("bob", 2000n, "Bob")],
    };
    const { container } = await stake(entry, "bob");

    expect(container).toHaveTextContent("You paid €20.00 · you owe €10.00");
    expect(screen.getByText("you owe €10.00")).toHaveClass("text-negative-ink");
  });

  it("says so, without a colour, when the reader paid exactly their share", async () => {
    const entry: EntryParties = {
      ...DINNER,
      payers: [party("ada", 6000n, "Ada"), party("bob", 3000n, "Bob")],
    };
    const { container } = await stake(entry, "bob");

    expect(container).toHaveTextContent("You paid €30.00 · exactly your share");
    expect(container.innerHTML).not.toMatch(/negative|positive/);
  });

  it("turns income round: whoever received it owes the others", async () => {
    const { container } = await stake(REFUND, "ada");

    expect(container).toHaveTextContent("You received €90.00 · you owe €60.00");
    expect(screen.getByText("you owe €60.00")).toHaveClass("text-negative-ink");
  });

  it("tells the others on an income what comes back to them", async () => {
    const { container } = await stake(REFUND, "bob");

    expect(container).toHaveTextContent(
      "Ada received it · you get back €30.00",
    );
    expect(screen.getByText("you get back €30.00")).toHaveClass(
      "text-positive-ink",
    );
  });

  it("speaks in the entry's own currency in a group that converts", async () => {
    // A dinner paid in dollars in a euro group: every other figure on the
    // screen is in dollars, and the strip under the total says the euros.
    const { container } = await stake(DINNER, "ada", { currency: "USD" });

    expect(container).toHaveTextContent(
      "You paid $90.00 · you get back $60.00",
    );
  });

  it("speaks to a guest the way it speaks to anybody else in the money", async () => {
    // A guest has a participant like everyone else, so the line is theirs —
    // here one who paid for the other three and had no share of it.
    const paidByGuest: EntryParties = {
      ...DINNER,
      payers: [party("guest", 9000n, "Dana")],
    };
    const { container } = await stake(paidByGuest, "guest");

    expect(container).toHaveTextContent(
      "You paid €90.00 · you get back €90.00",
    );
  });

  it("says plainly when the reader is not part of it", async () => {
    const { container } = await stake(DINNER, "dan");

    expect(container).toHaveTextContent("You’re not part of this expense");
    expect(container.querySelector("p")).toHaveClass("text-muted-foreground");
  });

  it("says the same to a member with no place in the money", async () => {
    const { container } = await stake(REFUND, null);

    expect(container).toHaveTextContent("You’re not part of this income");
  });

  it("says it in French, as one sentence", async () => {
    const owed = await stake(DINNER, "ada", { locale: "fr" });
    expect(plain(owed.container.textContent)).toBe(
      "Tu as payé 90,00 € · tu récupères 60,00 €",
    );
    owed.unmount();

    const owes = await stake(DINNER, "bob", { locale: "fr" });
    expect(plain(owes.container.textContent)).toBe(
      "Ada a payé · tu dois 30,00 €",
    );
  });
});

describe("the split", () => {
  it("says in words, where anyone can see them, what the entry did to each person", async () => {
    await split(DINNER, "ada");

    for (const [text, ink] of [
      ["You get back €60.00", "text-positive-ink"],
      ["Owes €30.00", "text-negative-ink"],
    ] as const) {
      for (const line of screen.getAllByText(text)) {
        expect(line).toHaveClass(ink);
        expect(line.closest(".sr-only")).toBeNull();
      }
    }
    expect(screen.getAllByText("Owes €30.00")).toHaveLength(2);
  });

  it("puts the reader first and speaks to them, wherever the entry lists them", async () => {
    await split(DINNER, "chloe");

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Chloé");
    expect(rows[0]).toHaveTextContent("You owe €30.00");
    expect(rows[1]).toHaveTextContent("Gets back €60.00");
  });

  it("names the figure on every row for a screen reader", async () => {
    await split(DINNER, "ada");

    for (const row of screen.getAllByRole("listitem")) {
      expect(row).toHaveTextContent(/Share\s*€30\.00/);
    }
  });

  it("leaves out the sign the words now carry", async () => {
    await split(DINNER, "ada");

    for (const row of screen.getAllByRole("listitem")) {
      expect(row.textContent).not.toMatch(/[+−]/);
    }
  });

  it("is a list a narrow phone can wrap, not a table it clips", async () => {
    await split(DINNER, "ada");

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("says who paid exactly their share, in the settled grey", async () => {
    const entry: EntryParties = {
      ...DINNER,
      payers: [party("ada", 6000n, "Ada"), party("bob", 3000n, "Bob")],
    };
    await split(entry, "ada");

    expect(screen.getByText("Paid their share")).toHaveClass(
      "text-neutral-balance-ink",
    );
  });

  it("says nothing under the names when the entry moved nobody", async () => {
    const evenly: EntryParties = {
      ...DINNER,
      payers: DINNER.shares,
    };
    await split(evenly, "ada");

    expect(screen.queryByText(/share$/)).toBeNull();
    expect(screen.queryByText(/Owes|Gets back|You/)).toBeNull();
  });

  it("credits an income, and words it the right way round", async () => {
    await split(REFUND, "bob");

    expect(screen.getByText("You get back €30.00")).toHaveClass(
      "text-positive-ink",
    );
    expect(screen.getByText("Owes €60.00")).toHaveClass("text-negative-ink");
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
      /Credited\s*€30\.00/,
    );
  });

  it("words every row in French", async () => {
    await split(DINNER, "ada", { locale: "fr" });

    const rows = screen.getAllByRole("listitem");
    expect(plain(rows[0]?.textContent ?? "")).toContain("Tu récupères 60,00 €");
    expect(plain(rows[1]?.textContent ?? "")).toContain("Doit 30,00 €");
  });
});

/**
 * The same split on a desk, where there is room for the table a phone could
 * not hold — and where what each person paid sits beside their share, so a
 * row says why it comes out where it does.
 */
describe("the split at width", () => {
  async function table(
    entry: EntryParties,
    participantId: string | null,
    options: { locale?: AppLocale } = {},
  ) {
    const locale = options.locale ?? "en";
    intl.locale = locale;
    return renderWithIntl(
      await SplitTable({
        entry,
        participantId,
        currency: "EUR",
        locale,
        label: "Split between",
      }),
      { locale },
    );
  }

  /** The cells of one body row, as text. */
  const cells = (row: HTMLElement) =>
    [
      ...within(row).getAllByRole("rowheader"),
      ...within(row).getAllByRole("cell"),
    ].map((cell) => plain(cell.textContent));

  it("is a table named after its section, with a column for each fact", async () => {
    await table(DINNER, "ada");

    expect(
      screen.getByRole("table", { name: "Split between" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["Person", "Share", "Paid", "What this did"]);
  });

  it("puts the reader first, and says what the entry did in words", async () => {
    await table(DINNER, "chloe");

    const [, first, second] = screen.getAllByRole("row");
    expect(cells(first)).toEqual(["CChloé", "€30.00", "—", "You owe €30.00"]);
    expect(cells(second)).toEqual([
      "AAda",
      "€30.00",
      "€90.00",
      "Gets back €60.00",
    ]);
    expect(within(second).getByText("Gets back €60.00")).toHaveClass(
      "text-positive-ink",
    );
    expect(within(first).getByText("You owe €30.00")).toHaveClass(
      "text-negative-ink",
    );
  });

  it("leaves out the sign the words now carry", async () => {
    await table(DINNER, "ada");

    for (const row of screen.getAllByRole("row")) {
      expect(row.textContent).not.toMatch(/[+−]/);
    }
  });

  it("gives a row to somebody who paid without a share of it", async () => {
    // Dana paid for the three of them and ate elsewhere: on a phone she is
    // only under "Paid by", and the table is both lists at once.
    const entry: EntryParties = {
      ...DINNER,
      payers: [party("dana", 9000n, "Dana")],
    };
    await table(entry, "ada");

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(5);
    expect(cells(rows[4])).toEqual([
      "DDana",
      "—",
      "€90.00",
      "Gets back €90.00",
    ]);
  });

  it("heads an income's columns the way income is read", async () => {
    await table(REFUND, "bob");

    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["Person", "Credited", "Received", "What this did"]);
    expect(screen.getByText("Owes €60.00")).toHaveClass("text-negative-ink");
  });

  it("drops the outcome column when the entry moved nobody", async () => {
    const evenly: EntryParties = { ...DINNER, payers: DINNER.shares };
    await table(evenly, "ada");

    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.queryByText(/Owes|Gets back|You/)).toBeNull();
  });

  it("words every row in French", async () => {
    await table(DINNER, "ada", { locale: "fr" });

    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["Personne", "Part", "Payé", "Ce que ça a fait"]);
    const [, first, second] = screen.getAllByRole("row");
    expect(cells(first).at(-1)).toBe("Tu récupères 60,00 €");
    expect(cells(second).at(-1)).toBe("Doit 30,00 €");
  });
});
