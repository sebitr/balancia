import { useSyncExternalStore } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import {
  fitBandsToHeight,
  Transactions,
  type BandView,
  type RowView,
} from "./transactions";

/**
 * The spine, the kind chips and the search are the filters, so these tests
 * drive them the way a finger does and read the list back.
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
    categories: ["utilities"],
    total: "3990",
    share: 21,
    rank: 1,
  },
  {
    key: "transport",
    categories: ["transport"],
    total: "2250",
    share: 12,
    rank: 2,
  },
];

describe("fitBandsToHeight", () => {
  it("shows more categories on a tall spine and groups them on a short one", () => {
    expect(fitBandsToHeight(BANDS, 600)).toHaveLength(7);

    const short = fitBandsToHeight(BANDS, 297);
    expect(short).toHaveLength(4);
    expect(short[3].categories).toEqual([
      "groceries",
      "shopping",
      "utilities",
      "transport",
    ]);
    expect(short[3].total).toBe("20400");
  });
});

function row(overrides: Partial<RowView> = {}): RowView {
  return {
    kind: "expense",
    id: "e1",
    date: "2026-08-13",
    createdAt: "2026-08-13T10:00:00.000Z",
    title: "Something",
    amount: "2500",
    currency: "EUR",
    note: null,
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

function renderList(rows: readonly RowView[] = ROWS, search = "") {
  window.history.replaceState(null, "", `/groups/g1/expenses${search}`);
  return renderWithIntl(
    <Transactions
      groupId="g1"
      eyebrow={<h1>Transactions</h1>}
      bands={BANDS}
      rows={rows}
    />,
  );
}

const band = (name: string) =>
  screen.getByRole("button", { name: `Show only ${name}` });

/** The same band once it is on: it names the press that would let go. */
const pressedBand = (name: string) =>
  screen.getByRole("button", { name: `Stop filtering by ${name}` });

/** A kind chip, named by the label it wears. */
const kind = (name: string) => screen.getByRole("button", { name });

describe("Transactions", () => {
  it("opens on everything, with nothing above the list summarising it", () => {
    renderList();

    expect(screen.getAllByRole("listitem")).toHaveLength(ROWS.length);
    // No headline total and no count of what it covers: the list is the
    // answer, and a figure over it was only ever a second telling.
    expect(screen.queryByText("spent")).not.toBeInTheDocument();
    expect(screen.queryByText(/7 categories/)).not.toBeInTheDocument();
  });

  it("narrows to one category when its band is tapped", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Travel"));

    expect(screen.getByText("airbnb")).toBeVisible();
    expect(screen.queryByText("Migros")).not.toBeInTheDocument();
    // Pressed, and now offering the way back out — the band is both.
    expect(pressedBand("Travel")).toHaveAttribute("aria-pressed", "true");
  });

  it("holds several bands at once, showing the union of them", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Travel"));
    await user.click(band("Groceries"));

    expect(screen.getByText("airbnb")).toBeVisible();
    expect(screen.getByText("Migros")).toBeVisible();
    expect(screen.queryByText("Uber")).not.toBeInTheDocument();
  });

  it("records the selection in the URL, so the screen can be linked to", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Travel"));
    await user.click(band("Groceries"));

    expect(window.location.search).toBe("?cat=travel&cat=groceries");
  });

  it("groups the categories that do not fit behind one band", async () => {
    const user = userEvent.setup();
    renderList();

    // Utilities and Transport share the sixth band, so it filters to both.
    await user.click(band("Utilities +1"));

    expect(screen.getByText("Internet")).toBeVisible();
    expect(screen.getByText("Uber")).toBeVisible();
    expect(screen.queryByText("airbnb")).not.toBeInTheDocument();
    expect(window.location.search).toBe("?cat=utilities&cat=transport");
  });

  it("takes a band back off by pressing it again", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Travel"));
    // The band is the whole control: pressed it filters, pressed again it
    // says so, and lets go.
    await user.click(
      screen.getByRole("button", { name: "Stop filtering by Travel" }),
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(ROWS.length);
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

  it("uses plus and minus signs for positive and negative positions", () => {
    renderList([
      row({ id: "back", title: "Back", position: "1250" }),
      row({ id: "owed", title: "Owed", position: "-1250" }),
    ]);

    expect(
      within(screen.getByText("Back").closest("li")!).getByText("+"),
    ).toBeVisible();
    expect(
      within(screen.getByText("Owed").closest("li")!).getByText("−"),
    ).toBeVisible();
  });

  it("opens a settlement on its own detail screen", () => {
    renderList();

    const settlement = screen.getByText("Seb paid Padi").closest("li");
    expect(settlement).not.toBeNull();
    // Not the edit drawer: the row cannot say whether the repayment finished
    // the job, and the screen behind it is where that is answered.
    expect(within(settlement!).getByRole("link")).toHaveAttribute(
      "href",
      "/groups/g1/settlements/s1",
    );
    // It is a repayment, so it closes a position rather than moving one.
    expect(within(settlement!).getByText("settled")).toBeInTheDocument();
  });

  it("says what a repayment was for, beside the date", () => {
    renderList([
      row({
        kind: "settlement",
        id: "s1",
        title: "Seb paid Padi",
        category: null,
        note: "Bus tickets",
      }),
    ]);

    // The names lead, because they are the fact; the words go after the date
    // rather than in place of them.
    expect(screen.getByText(/\u00b7 Bus tickets$/)).toBeVisible();
  });

  it("leaves the line to the date when nobody said what it was for", () => {
    renderList([
      row({
        kind: "settlement",
        id: "s1",
        title: "Seb paid Padi",
        category: null,
      }),
    ]);

    expect(screen.queryByText(/\u00b7/)).not.toBeInTheDocument();
  });

  it("searches what a repayment was for, not only the two names", async () => {
    const user = userEvent.setup();
    renderList([
      row({
        kind: "settlement",
        id: "s1",
        title: "Seb paid Padi",
        category: null,
        note: "Bus tickets",
      }),
      row({ id: "migros", title: "Migros", category: "groceries" }),
    ]);

    await user.type(screen.getByRole("searchbox"), "bus");

    expect(screen.getByText("Seb paid Padi")).toBeVisible();
    expect(screen.queryByText("Migros")).not.toBeInTheDocument();
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

  it("holds several kinds at once rather than swapping between them", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(kind("Expenses"));
    await user.click(kind("Settlements"));

    expect(kind("Expenses")).toHaveAttribute("aria-pressed", "true");
    expect(kind("Settlements")).toHaveAttribute("aria-pressed", "true");
    // Spending and the repayment stand together; the revenue row is the one
    // left out, which is what proves the pair filters rather than clears.
    expect(screen.getByText("Seb paid Padi")).toBeVisible();
    expect(screen.getByText("airbnb")).toBeVisible();
    expect(screen.queryByText("Airbnb refund")).not.toBeInTheDocument();
    expect(window.location.search).toBe("?kind=expense&kind=settlement");
  });

  it("returns to everything when the last kind is switched back off", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(kind("Revenue"));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Airbnb refund")).toBeVisible();

    await user.click(kind("Revenue"));
    expect(screen.getAllByRole("listitem")).toHaveLength(ROWS.length);
    expect(window.location.search).toBe("");
  });

  it("narrows with the bands rather than fighting them", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(kind("Expenses"));
    await user.click(band("Travel"));

    // Travel holds two rows, and one of them is the refund — so the pair of
    // filters has to intersect to leave one.
    expect(screen.getByText("airbnb")).toBeVisible();
    expect(screen.queryByText("Airbnb refund")).not.toBeInTheDocument();
  });

  it("drops the chip for a kind the group has never recorded", () => {
    renderList(ROWS.filter((row) => !row.revenue));

    expect(kind("Expenses")).toBeInTheDocument();
    expect(kind("Settlements")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Revenue" }),
    ).not.toBeInTheDocument();
  });

  it("shows no row at all when only one kind was ever recorded", () => {
    const spending = ROWS.filter(
      (row) => row.kind === "expense" && !row.revenue,
    );
    renderList(spending);

    expect(
      screen.queryByRole("group", { name: "Filter by kind" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(spending.length);
  });

  it("ignores a kind in the URL that this group cannot show", () => {
    const withoutRevenue = ROWS.filter((row) => !row.revenue);
    renderList(withoutRevenue, "?kind=revenue");

    // A link built in a group that had revenue must not empty this one.
    expect(screen.getAllByRole("listitem")).toHaveLength(withoutRevenue.length);
  });
});

describe("Transactions without a single currency", () => {
  it("drops the spine without explaining itself above the list", () => {
    window.history.replaceState(null, "", "/groups/g1/expenses");
    renderWithIntl(
      <Transactions
        groupId="g1"
        eyebrow={<h1>Transactions</h1>}
        bands={null}
        rows={ROWS}
      />,
    );

    // The list starts at the top: no standing note about exchange rates
    // between the screen's name and the transactions themselves.
    expect(screen.queryByText(/spread needs one currency/)).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Spending by category" }),
    ).not.toBeInTheDocument();
    // What does not need a rate to work is still here.
    expect(
      screen.getByRole("group", { name: "Filter by kind" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeVisible();
  });
});
