import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { Transactions, type EntryKind, type RowView } from "./transactions";

/**
 * The transactions at width: the same list, drawn as a table from `lg` up,
 * with its filters on one row above it.
 *
 * `matchMedia` is the switch. The shared setup answers false to every query,
 * which is a phone, and `transactions.test.tsx` drives that renderer as it
 * always has; here it answers true to `lg`, so the table is the one mounted.
 * The URL is real for the same reason it is there: the filters' only way to
 * record a choice is `history.replaceState`.
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
  useRouter: () => ({ refresh: vi.fn() }),
}));

const replaceState = window.history.replaceState.bind(window.history);
window.history.replaceState = (
  ...args: Parameters<History["replaceState"]>
) => {
  replaceState(...args);
  for (const notify of listeners) notify();
};

let matchMedia: typeof window.matchMedia;

/** A window from `lg` up: the one query the table listens to answers yes. */
function atDesk(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide && query === "(min-width: 64rem)",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  matchMedia = window.matchMedia;
  atDesk(true);
});

afterEach(() => {
  window.matchMedia = matchMedia;
});

function row(overrides: Partial<RowView> = {}): RowView {
  return {
    kind: "expense",
    id: "e1",
    date: "2026-08-13",
    title: "Something",
    amount: "2500",
    currency: "EUR",
    note: null,
    category: "other",
    subcategory: null,
    position: null,
    revenue: false,
    recurring: false,
    payers: ["seb"],
    people: ["seb", "amelie"],
    foreign: false,
    receipt: false,
    receipts: 0,
    payerNames: ["Seb"],
    split: { method: "equal", sharers: ["seb", "amelie"] },
    method: null,
    ...overrides,
  };
}

/** Read as Seb, in a group of Seb, Amélie and Jonas. */
const MEMBERS = [
  { id: "seb", displayName: "Seb" },
  { id: "amelie", displayName: "Amélie" },
  { id: "jonas", displayName: "Jonas" },
];

const ROWS: RowView[] = [
  row({
    id: "dinner",
    title: "Dinner at Trattoria Il Ponte",
    date: "2026-08-12",
    category: "restaurants",
    amount: "12840",
    payers: ["amelie"],
    payerNames: ["Amélie"],
    split: { method: "equal", sharers: ["seb", "amelie", "jonas"] },
    position: "-4280",
    receipt: true,
    receipts: 2,
  }),
  row({
    kind: "settlement",
    id: "s1",
    title: "Jonas paid you back",
    date: "2026-08-11",
    category: null,
    amount: "12000",
    payers: ["jonas"],
    payerNames: ["Jonas"],
    people: ["jonas", "seb"],
    split: null,
    method: "cash",
    note: "Settling the taxi",
    position: "12000",
  }),
  row({
    id: "cleaning",
    title: "Apartment cleaning",
    date: "2026-08-09",
    category: "home",
    amount: "6500",
    recurring: true,
    payers: ["seb"],
    payerNames: ["Seb"],
    split: { method: "equal", sharers: ["seb", "amelie"] },
    position: "3250",
  }),
  row({
    id: "old",
    title: "Last summer's ferry",
    date: "2025-07-02",
    category: "transport",
    amount: "4000",
    payers: ["amelie", "jonas"],
    payerNames: ["Amélie", "Jonas"],
    split: { method: "shares", sharers: ["seb", "amelie", "jonas"] },
  }),
];

function kindsOf(rows: readonly RowView[]): EntryKind[] {
  return (["expense", "revenue", "settlement"] as const).filter((kind) =>
    rows.some((entry) =>
      entry.kind === "settlement"
        ? kind === "settlement"
        : kind === (entry.revenue ? "revenue" : "expense"),
    ),
  );
}

function renderTable(rows: readonly RowView[] = ROWS, search = "") {
  window.history.replaceState(null, "", `/groups/g1/expenses${search}`);
  return renderWithIntl(
    <Transactions
      groupId="g1"
      eyebrow={<h1>Transactions</h1>}
      bands={null}
      kinds={kindsOf(rows)}
      rows={rows}
      cursor={null}
      members={MEMBERS}
      used={["home", "restaurants", "transport"]}
      counts={{ home: 1, restaurants: 1, transport: 1 }}
      byAmount
      firstDate="2025-07-02"
      today="2026-08-14"
      self="seb"
      total={rows.length}
    />,
    // The group's own provider, so a string from a namespace the screen is
    // not handed would print as its key here rather than pass.
    { area: "group" },
  );
}

/** The data rows, without the header. */
function bodyRows() {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1);
}

describe("Transactions at width", () => {
  it("draws the rows as a table rather than the phone's list", () => {
    renderTable();

    expect(screen.getByRole("table", { name: "Transactions" })).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual([
      "Date",
      "Description",
      "Category",
      "Paid by",
      "Split",
      "Amount",
      "For you",
    ]);
    expect(bodyRows()).toHaveLength(ROWS.length);
  });

  it("makes each row one link to its entry, repayments included", () => {
    renderTable();

    const links = bodyRows().map((line) => within(line).getAllByRole("link"));
    expect(links.map((found) => found.length)).toEqual([1, 1, 1, 1]);
    expect(links[0][0]).toHaveAttribute("href", "/groups/g1/expenses/dinner");
    expect(links[1][0]).toHaveAttribute("href", "/groups/g1/settlements/s1");
    expect(links[1][0]).toHaveTextContent("Jonas paid you back");
  });

  it("keeps the list's filters on the way into a row", () => {
    renderTable(ROWS, "?q=dinner");

    expect(
      screen.getByRole("link", { name: "Dinner at Trattoria Il Ponte" }),
    ).toHaveAttribute("href", "/groups/g1/expenses/dinner?q=dinner");
  });

  it("says who paid, how it was split, and the receipts", () => {
    renderTable();
    const [dinner, repayment, cleaning, ferry] = bodyRows();

    // Everyone in the group carries a share: "3 equally".
    expect(within(dinner).getByText("3 equally")).toBeInTheDocument();
    expect(within(dinner).getByText("2 receipts")).toBeInTheDocument();
    // The reader is "You", and a subset of the group is "2 of 3".
    expect(within(cleaning).getByText("You")).toBeInTheDocument();
    expect(within(cleaning).getByText("2 of 3")).toBeInTheDocument();
    // Two payers are joined the way the language joins them.
    expect(within(ferry).getByText("Amélie and Jonas")).toBeInTheDocument();
    expect(within(ferry).getByText("3, by shares")).toBeInTheDocument();
    // A repayment is not shared out: its split is how it was paid.
    expect(within(repayment).getByText("Cash")).toBeInTheDocument();
    expect(within(repayment).getByText("Settling the taxi")).toBeVisible();
  });

  it("folds the same facts into the description's second line", () => {
    renderTable();
    const [dinner, repayment] = bodyRows();

    expect(
      within(dinner).getByText(
        "Restaurants · Amélie paid · 3 equally · 2 receipts",
      ),
    ).toBeInTheDocument();
    expect(
      within(repayment).getByText("Cash · Settling the taxi"),
    ).toBeInTheDocument();
  });

  it("says what each row left the reader holding, in words", () => {
    renderTable();
    const [dinner, repayment, cleaning, ferry] = bodyRows();

    // Under the amount where the table is folded, and in For you at width:
    // the same sentence twice in the DOM, one of them hidden by CSS.
    expect(within(dinner).getAllByText("You owe €42.80")[0]).toHaveClass(
      "text-negative-ink",
    );
    expect(within(cleaning).getAllByText("You get back €32.50")[0]).toHaveClass(
      "text-positive-ink",
    );
    // A repayment closes a position rather than opening one: neutral.
    expect(
      within(repayment).getAllByText("You received €120.00")[0],
    ).toHaveClass("text-neutral-balance-ink");
    // A row the reader is not in says nothing at all.
    expect(within(ferry).queryByText(/^You /)).not.toBeInTheDocument();
    // The total itself is a cost, and takes no tone.
    expect(within(dinner).getByText("€128.40")).not.toHaveClass(
      "text-negative-ink",
    );
  });

  it("shows a row's year only when it is not this one", () => {
    renderTable();
    const [dinner, , , ferry] = bodyRows();

    expect(within(dinner).getAllByRole("cell")[0]).toHaveTextContent(
      /^Aug 12$/,
    );
    expect(within(ferry).getAllByRole("cell")[0]).toHaveTextContent(/2025/);
  });

  it("sorts by date, newest first, and says so in the header", async () => {
    const user = userEvent.setup();
    renderTable();

    const date = screen.getByRole("columnheader", { name: "Date" });
    expect(date).toHaveAttribute("aria-sort", "descending");

    await user.click(within(date).getByRole("button", { name: "Date" }));

    expect(window.location.search).toBe("?sort=oldest");
    expect(date).toHaveAttribute("aria-sort", "ascending");
    expect(bodyRows()[0]).toHaveTextContent("Last summer's ferry");
  });

  it("can rank by amount where every amount is in one currency", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("button", { name: "Amount" }));

    expect(window.location.search).toBe("?sort=largest");
    expect(
      screen.getByRole("columnheader", { name: "Amount" }),
    ).toHaveAttribute("aria-sort", "descending");
    expect(bodyRows()[0]).toHaveTextContent("Dinner at Trattoria Il Ponte");
  });

  it("counts what it shows in the footer", () => {
    renderTable();

    expect(
      screen.getByText(
        "Showing 4 of 4 transactions · sorted by date, newest first",
      ),
    ).toBeInTheDocument();
  });

  it("narrows the table from the search field", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.type(
      screen.getByRole("searchbox", { name: "Search transactions" }),
      "ferry",
    );

    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("Last summer's ferry");
    expect(
      screen.getByText(
        "Showing 1 of 1 transaction · sorted by date, newest first",
      ),
    ).toBeInTheDocument();
  });

  it("narrows by kind with the phone's chips", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("button", { name: "Repayments" }));

    expect(window.location.search).toBe("?kind=settlement");
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("Jonas paid you back");
  });

  it("narrows by category from a menu that stays open for the next", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(
      screen.getByRole("button", { name: "Category: Any category" }),
    );
    await user.click(
      await screen.findByRole("menuitemcheckbox", { name: /Home/ }),
    );
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: /Transport/ }),
    );

    expect(window.location.search).toBe("?cat=home&cat=transport");
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("button", { name: "Category: Home +1" }),
    ).toBeInTheDocument();
    expect(bodyRows().map((line) => line.textContent)).toEqual([
      expect.stringContaining("Apartment cleaning"),
      expect.stringContaining("Last summer's ferry"),
    ]);
  });

  it("narrows to a month, written as the range the sheet can show", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("button", { name: "When: Any time" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "July 2025" }),
    );

    expect(window.location.search).toBe(
      "?when=custom&from=2025-07-01&to=2025-07-31",
    );
    expect(
      screen.getByRole("button", { name: "When: July 2025" }),
    ).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(1);
  });

  it("opens the filter sheet for everything the row cannot ask", async () => {
    const user = userEvent.setup();
    renderTable(ROWS, "?pos=owe");

    await user.click(
      screen.getByRole("button", { name: "More filters, 1 applied" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Filter and sort" }),
    ).toBeInTheDocument();
  });

  it("adds an expense through the same route as the bar's Add", () => {
    renderTable();

    expect(
      screen.getByRole("link", { name: "Add an expense" }),
    ).toHaveAttribute("href", "/groups/g1/expenses/new");
  });

  it("says nothing matches only once there is nothing left to read", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.type(
      screen.getByRole("searchbox", { name: "Search transactions" }),
      "zzz",
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No transaction matches that")).toBeInTheDocument();
  });

  it("writes the table in French", () => {
    window.history.replaceState(null, "", "/groups/g1/expenses");
    renderWithIntl(
      <Transactions
        groupId="g1"
        eyebrow={<h1>Transactions</h1>}
        bands={null}
        kinds={kindsOf(ROWS)}
        rows={ROWS}
        // More to read: the footer counts against the group's own total.
        cursor="next"
        members={MEMBERS}
        used={["home", "restaurants", "transport"]}
        counts={{ home: 1, restaurants: 1, transport: 1 }}
        byAmount
        firstDate="2025-07-02"
        today="2026-08-14"
        self="seb"
        total={42}
      />,
      { area: "group", locale: "fr" },
    );
    const [dinner, , cleaning, ferry] = bodyRows();

    expect(within(dinner).getByText("3 à parts égales")).toBeInTheDocument();
    expect(within(cleaning).getByText("Toi")).toBeInTheDocument();
    expect(within(ferry).getByText("Amélie et Jonas")).toBeInTheDocument();
    const footer = screen.getByText(/affichées/);
    expect(footer.textContent).toBe(
      "4 transactions affichées sur 42 · triées par date, plus récentes d’abord",
    );
    expect(
      screen.getByText("La suite se charge quand tu fais défiler"),
    ).toBeInTheDocument();
  });
});

describe("Transactions at width, beyond the first page", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the server how many a filter leaves when the rows in hand cannot say", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const params = new URL(url, "http://test").searchParams;
      return {
        ok: true,
        json: async () =>
          params.has("count")
            ? { count: 97 }
            : { rows: [ROWS[0]], cursor: "more" },
      } as Response;
    });
    window.history.replaceState(null, "", "/groups/g1/expenses?q=dinner");
    renderWithIntl(
      <Transactions
        groupId="g1"
        eyebrow={<h1>Transactions</h1>}
        bands={null}
        kinds={kindsOf(ROWS)}
        rows={ROWS}
        cursor="next"
        members={MEMBERS}
        used={["home", "restaurants", "transport"]}
        counts={{ home: 1, restaurants: 1, transport: 1 }}
        byAmount
        firstDate="2025-07-02"
        today="2026-08-14"
        self="seb"
        total={420}
      />,
      { area: "group" },
    );

    expect(
      await screen.findByText(
        "Showing 1 of 97 transactions · sorted by date, newest first",
      ),
    ).toBeInTheDocument();
  });

  it("asks nothing of the kind on a phone, which has no footer to say it in", async () => {
    atDesk(false);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [ROWS[0]], cursor: null }),
    } as Response);
    window.history.replaceState(null, "", "/groups/g1/expenses?q=dinner");
    renderWithIntl(
      <Transactions
        groupId="g1"
        eyebrow={<h1>Transactions</h1>}
        bands={null}
        kinds={kindsOf(ROWS)}
        rows={ROWS}
        cursor="next"
        members={MEMBERS}
        used={["home", "restaurants", "transport"]}
        counts={{ home: 1, restaurants: 1, transport: 1 }}
        byAmount
        firstDate="2025-07-02"
        today="2026-08-14"
        self="seb"
        total={420}
      />,
      { area: "group" },
    );

    expect(
      await screen.findByText("Dinner at Trattoria Il Ponte"),
    ).toBeInTheDocument();
    const counts = fetchMock.mock.calls.filter(([url]) =>
      new URL(url as string, "http://test").searchParams.has("count"),
    );
    expect(counts).toEqual([]);
  });
});

describe("Transactions below lg", () => {
  it("mounts the phone's list and no table", () => {
    atDesk(false);
    renderTable();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(ROWS.length);
  });
});
