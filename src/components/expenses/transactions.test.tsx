import { useSyncExternalStore } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { Transactions, type BandView, type RowView } from "./transactions";

/**
 * The spine is the filter, so these tests drive it the way a finger does and
 * then read the hero, the chips and the list back.
 *
 * `useSearchParams` is backed by the real URL rather than by a stand-in
 * setState: the component's only way to record a selection is
 * `history.replaceState`, and a mock that skipped that would test a code path
 * the browser never runs.
 */
const listeners = new Set<() => void>();

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      useSyncExternalStore(
        (notify: () => void) => {
          listeners.add(notify);
          return () => listeners.delete(notify);
        },
        () => window.location.search,
        () => "",
      ),
    ),
}));

const replaceState = window.history.replaceState.bind(window.history);
window.history.replaceState = (
  ...args: Parameters<History["replaceState"]>
) => {
  replaceState(...args);
  for (const notify of listeners) notify();
};

/** Every band's key is its lead category, as the server builds them. */
const BANDS: BandView[] = [
  {
    key: "travel",
    categories: ["travel"],
    total: "150000",
    share: 786,
    rank: 1,
  },
  {
    key: "restaurants",
    categories: ["restaurants"],
    total: "11010",
    share: 58,
    rank: 2,
  },
  { key: "other", categories: ["other"], total: "9500", share: 50, rank: 3 },
  {
    key: "groceries",
    categories: ["groceries"],
    total: "8675",
    share: 45,
    rank: 4,
  },
  {
    key: "shopping",
    categories: ["shopping"],
    total: "5485",
    share: 29,
    rank: 5,
  },
  {
    key: "utilities",
    categories: ["utilities", "transport"],
    total: "6240",
    share: 33,
    rank: null,
  },
];

function row(overrides: Partial<RowView> = {}): RowView {
  return {
    kind: "expense",
    id: "e1",
    date: "2026-08-13",
    createdAt: "2026-08-13T10:00:00.000Z",
    title: "Something",
    amount: "2500",
    currency: "EUR",
    category: "other",
    position: "1250",
    revenue: false,
    recurring: false,
    ...overrides,
  };
}

const ROWS: RowView[] = [
  row({
    id: "airbnb",
    title: "airbnb",
    category: "travel",
    amount: "150000",
    position: "-75000",
  }),
  row({
    id: "glace",
    title: "Glace",
    category: "restaurants",
    amount: "1450",
    position: "725",
  }),
  row({
    id: "migros",
    title: "Migros",
    category: "groceries",
    amount: "8675",
    position: "4338",
  }),
  row({
    id: "uber",
    title: "Uber",
    category: "transport",
    amount: "2250",
    position: "-1125",
  }),
  row({
    id: "internet",
    title: "Internet",
    category: "utilities",
    amount: "3990",
    position: "-1995",
    recurring: true,
  }),
  row({
    id: "refund",
    title: "Airbnb refund",
    category: "travel",
    amount: "12000",
    position: "6000",
    revenue: true,
  }),
  row({
    kind: "settlement",
    id: "s1",
    title: "Seb paid Padi",
    category: null,
    amount: "74000",
    position: "74000",
    date: "2026-08-12",
  }),
];

function renderList(rows: readonly RowView[] = ROWS) {
  window.history.replaceState(null, "", "/groups/g1/expenses");
  return renderWithIntl(
    <Transactions
      groupId="g1"
      eyebrow={<h1>Transactions · all time</h1>}
      bands={BANDS}
      spreads={[{ currency: "EUR", total: "190910", categories: 7 }]}
      rows={rows}
      repaid={[{ currency: "EUR", amount: "74000" }]}
      backIn={[{ currency: "EUR", amount: "12000" }]}
    />,
  );
}

const band = (name: string) =>
  screen.getByRole("button", { name: `Show only ${name}` });

/**
 * The headline figure, scoped to the hero.
 *
 * A filtered total is often also a row's amount — selecting the one expense in
 * a category is the obvious case — so the figure has to be read where it is
 * claimed to be, not anywhere on the screen.
 */
const heroTotal = () => within(screen.getByText("spent").closest("p")!);

describe("Transactions", () => {
  it("opens on everything, totalled and counted", () => {
    renderList();

    expect(heroTotal().getByText("€1,909.10")).toBeVisible();
    expect(
      screen.getByText(/7 categories.+€740\.00 repaid.+€120\.00 back in/),
    ).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(ROWS.length);
  });

  it("narrows to one category when its band is tapped", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Travel"));

    // The hero becomes that band's own spend, and counts what is left.
    expect(heroTotal().getByText("€1,500.00")).toBeVisible();
    expect(screen.getByText(/Travel.+2 of 7 transactions/)).toBeVisible();
    expect(screen.getByText("airbnb")).toBeVisible();
    expect(screen.queryByText("Migros")).not.toBeInTheDocument();
    expect(band("Travel")).toHaveAttribute("aria-pressed", "true");
  });

  it("holds several bands at once and sums them", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Travel"));
    await user.click(band("Groceries"));

    expect(heroTotal().getByText("€1,586.75")).toBeVisible();
    expect(screen.getByText(/2 categories.+3 of 7 transactions/)).toBeVisible();
    expect(screen.getByText("Migros")).toBeVisible();
  });

  it("records the selection in the URL, so the screen can be linked to", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Travel"));
    await user.click(band("Groceries"));

    expect(window.location.search).toBe("?cat=travel&cat=groceries");
  });

  it("groups the categories the palette ran out for behind one band", async () => {
    const user = userEvent.setup();
    renderList();

    // Utilities and Transport share the sixth band, so it filters to both.
    await user.click(band("Utilities +1"));

    expect(screen.getByText("Internet")).toBeVisible();
    expect(screen.getByText("Uber")).toBeVisible();
    expect(screen.queryByText("airbnb")).not.toBeInTheDocument();
  });

  it("takes a band back off with its chip", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Travel"));
    await user.click(
      screen.getByRole("button", { name: "Stop filtering by Travel" }),
    );

    expect(heroTotal().getByText("€1,909.10")).toBeVisible();
    expect(screen.getByText("Migros")).toBeVisible();
  });

  it("offers Clear all only once there is more than one thing to clear", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Travel"));
    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();

    await user.click(band("Groceries"));
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(heroTotal().getByText("€1,909.10")).toBeVisible();
    expect(window.location.search).toBe("");
  });

  it("combines the search with the bands rather than replacing them", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Travel"));
    await user.type(screen.getByRole("searchbox"), "refund");

    expect(screen.getByText("Airbnb refund")).toBeVisible();
    expect(screen.queryByText("airbnb")).not.toBeInTheDocument();
  });

  it("says so when nothing matches, instead of showing an empty column", async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(screen.getByRole("searchbox"), "zzz");

    expect(screen.getByText("No transaction matches that")).toBeVisible();
    expect(
      screen.getByText("Try a shorter word, or clear the category bands."),
    ).toBeVisible();
  });

  it("keeps the word beside every position, so colour is never the only cue", () => {
    renderList([
      row({ id: "back", title: "Back", position: "1250" }),
      row({ id: "owed", title: "Owed", position: "-1250" }),
    ]);

    expect(screen.getByText("you get back")).toBeInTheDocument();
    expect(screen.getByText("you owe")).toBeInTheDocument();
  });

  it("does not offer a settlement as something to open", () => {
    renderList();

    const settlement = screen.getByText("Seb paid Padi").closest("li");
    expect(settlement).not.toBeNull();
    expect(within(settlement!).queryByRole("link")).not.toBeInTheDocument();
    // It is a repayment, so it closes a position rather than moving one.
    expect(within(settlement!).getByText("settled")).toBeInTheDocument();
  });

  it("links every expense to its detail", () => {
    renderList();

    expect(screen.getByRole("link", { name: /Migros/ })).toHaveAttribute(
      "href",
      "/groups/g1/expenses/migros",
    );
  });

  it("prints a share on every band, to a tenth where that is the difference", () => {
    renderList();

    expect(within(band("Travel")).getByText("79%")).toBeInTheDocument();
    expect(
      within(band("Restaurants & Drinks")).getByText("5.8%"),
    ).toBeInTheDocument();
  });
});

describe("Transactions without a single currency", () => {
  it("stands the totals side by side rather than inventing a rate", () => {
    window.history.replaceState(null, "", "/groups/g1/expenses");
    renderWithIntl(
      <Transactions
        groupId="g1"
        eyebrow={<h1>Transactions · all time</h1>}
        bands={null}
        spreads={[
          { currency: "EUR", total: "190910", categories: 7 },
          { currency: "USD", total: "9169", categories: 2 },
        ]}
        rows={ROWS}
        repaid={[]}
        backIn={[]}
      />,
    );

    expect(screen.getByText("€1,909.10")).toBeVisible();
    expect(screen.getByText("$91.69")).toBeVisible();
    expect(screen.getByText(/The spread needs one currency/)).toBeVisible();
    // No spine, so nothing to filter by — but the search still works.
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeVisible();
  });
});
