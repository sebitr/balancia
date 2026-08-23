import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import {
  fitBandsToHeight,
  Transactions,
  type BandView,
  type EntryKind,
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
    key: "lodging",
    categories: ["lodging"],
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
    key: "home",
    categories: ["home"],
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
      "home",
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
    category: "lodging",
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
    category: "home",
    amount: "3990",
    position: "-1995",
    recurring: true,
  }),
  row({
    id: "refund",
    title: "Airbnb refund",
    category: "lodging",
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

/**
 * The chips the server would have offered for a group holding exactly `rows`.
 *
 * The real page counts these over the whole group rather than over the page it
 * is rendering, so the component is told rather than left to work it out. Here
 * the rows *are* the whole group.
 */
function kindsOf(rows: readonly RowView[]): EntryKind[] {
  return KINDS.filter((kind) =>
    rows.some((row) =>
      row.kind === "settlement"
        ? kind === "settlement"
        : kind === (row.revenue ? "revenue" : "expense"),
    ),
  );
}

const KINDS = ["expense", "revenue", "settlement"] as const;

function renderList(
  rows: readonly RowView[] = ROWS,
  search = "",
  cursor: string | null = null,
) {
  window.history.replaceState(null, "", `/groups/g1/expenses${search}`);
  return renderWithIntl(
    <Transactions
      groupId="g1"
      eyebrow={<h1>Transactions</h1>}
      bands={BANDS}
      kinds={kindsOf(rows)}
      rows={rows}
      cursor={cursor}
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

    await user.click(band("Lodging"));

    expect(screen.getByText("airbnb")).toBeVisible();
    expect(screen.queryByText("Migros")).not.toBeInTheDocument();
    // Pressed, and now offering the way back out — the band is both.
    expect(pressedBand("Lodging")).toHaveAttribute("aria-pressed", "true");
  });

  it("holds several bands at once, showing the union of them", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Lodging"));
    await user.click(band("Groceries"));

    expect(screen.getByText("airbnb")).toBeVisible();
    expect(screen.getByText("Migros")).toBeVisible();
    expect(screen.queryByText("Uber")).not.toBeInTheDocument();
  });

  it("records the selection in the URL, so the screen can be linked to", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Lodging"));
    await user.click(band("Groceries"));

    expect(window.location.search).toBe("?cat=lodging&cat=groceries");
  });

  it("groups the categories that do not fit behind one band", async () => {
    const user = userEvent.setup();
    renderList();

    // Home and Transport share the sixth band, so it filters to both.
    await user.click(band("Home +1"));

    expect(screen.getByText("Internet")).toBeVisible();
    expect(screen.getByText("Uber")).toBeVisible();
    expect(screen.queryByText("airbnb")).not.toBeInTheDocument();
    expect(window.location.search).toBe("?cat=home&cat=transport");
  });

  it("takes a band back off by pressing it again", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Lodging"));
    // The band is the whole control: pressed it filters, pressed again it
    // says so, and lets go.
    await user.click(
      screen.getByRole("button", { name: "Stop filtering by Lodging" }),
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(ROWS.length);
    expect(window.location.search).toBe("");
  });

  it("combines the search with the bands rather than replacing them", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(band("Lodging"));
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

    expect(within(band("Lodging")).getByText("79%")).toBeInTheDocument();
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
    await user.click(band("Lodging"));

    // Lodging holds two rows, and one of them is the refund — so the pair of
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
        kinds={kindsOf(ROWS)}
        rows={ROWS}
        cursor={null}
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

/**
 * The list reads itself a page at a time, and jsdom has no scrolling and no
 * IntersectionObserver — so the observer is replaced with one these tests can
 * fire by hand, which is the same event a thumb reaching the bottom produces.
 */
interface Watcher {
  readonly callback: IntersectionObserverCallback;
  target: Element | null;
}

const watchers = new Set<Watcher>();

class StubObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly scrollMargin = "";
  readonly thresholds: readonly number[] = [];
  private readonly watcher: Watcher;

  constructor(callback: IntersectionObserverCallback) {
    this.watcher = { callback, target: null };
  }

  observe(target: Element) {
    this.watcher.target = target;
    watchers.add(this.watcher);
  }

  unobserve() {
    watchers.delete(this.watcher);
  }

  disconnect() {
    watchers.delete(this.watcher);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** The reader arrives at the bottom of what has been loaded so far. */
async function reachBottom() {
  await act(async () => {
    for (const watcher of watchers) {
      watcher.callback(
        [
          {
            isIntersecting: true,
            target: watcher.target,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    }
  });
}

function page(rows: RowView[], cursor: string | null = null) {
  return { ok: true, json: async () => ({ rows, cursor }) } as Response;
}

const OLDER = row({
  id: "hotel",
  title: "Hôtel du Lac",
  date: "2019-07-02",
  category: "lodging",
});

describe("Transactions beyond the first page", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    watchers.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", StubObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the next page when the reader reaches the bottom", async () => {
    fetchMock.mockResolvedValue(page([OLDER]));
    const cursor = "2026-08-12|2026-08-12T09:00:00.000000Z|s1";
    renderList(ROWS, "", cursor);

    // Nothing is fetched for a reader who has not got there yet.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Hôtel du Lac")).toBeNull();

    await reachBottom();

    expect(await screen.findByText("Hôtel du Lac")).toBeVisible();
    // The rows already on screen stay where they were: this is one list
    // continuing, not a page being replaced.
    expect(screen.getByText("airbnb")).toBeVisible();

    const asked = new URL(fetchMock.mock.calls[0][0] as string, "http://test");
    expect(asked.pathname).toBe("/api/groups/g1/transactions");
    expect(asked.searchParams.get("cursor")).toBe(cursor);
  });

  it("asks for nothing once the list has ended", async () => {
    fetchMock.mockResolvedValue(page([OLDER]));
    renderList(ROWS, "", null);

    await reachBottom();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the rest of the list as soon as a filter is on", async () => {
    fetchMock.mockResolvedValue(page([OLDER]));
    renderList(ROWS, "", "2026-08-12|2026-08-12T09:00:00.000000Z|s1");

    // Typed, never scrolled: a search that only knew the rows already on
    // screen would answer "nothing matches" about a hotel it has not read yet.
    await userEvent.type(screen.getByRole("searchbox"), "hôtel");

    expect(await screen.findByText("Hôtel du Lac")).toBeVisible();
    const asked = new URL(fetchMock.mock.calls[0][0] as string, "http://test");
    expect(asked.searchParams.get("limit")).toBe("500");
  });

  it("says nothing matches only once there is nothing left to read", async () => {
    fetchMock.mockResolvedValue(page([OLDER]));
    renderList(ROWS, "", "2026-08-12|2026-08-12T09:00:00.000000Z|s1");

    await userEvent.type(screen.getByRole("searchbox"), "hôtel");
    await screen.findByText("Hôtel du Lac");

    expect(screen.queryByText("No transaction matches that")).toBeNull();
  });

  it("stops after a failure, and waits to be told to try again", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    renderList(ROWS, "", "2026-08-12|2026-08-12T09:00:00.000000Z|s1");

    await reachBottom();
    expect(
      await screen.findByText("Earlier transactions could not be loaded."),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Scrolling again must not re-fire it: a failing endpoint asked once per
    // nudge of the scrollbar is worse than a sentence and a button.
    await reachBottom();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValue(page([OLDER]));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Hôtel du Lac")).toBeVisible();
  });
});

/**
 * Opening a row and coming back.
 *
 * The filters go out on the link and come home on the detail screen's own; how
 * much of the list had been read, and how far down it the reader was, ride in
 * `sessionStorage` for the length of the trip. Both halves are driven here,
 * because either one alone still puts the reader somewhere they were not.
 */
describe("Transactions, left and returned to", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    watchers.clear();
    fetchMock.mockReset();
    sessionStorage.clear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", StubObserver);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The reader, some way down the page. */
  function scrolledTo(y: number) {
    vi.spyOn(window, "scrollY", "get").mockReturnValue(y);
  }

  it("carries the filters into the entry it opens", async () => {
    renderList();

    await userEvent.click(band("Lodging"));
    await userEvent.type(screen.getByRole("searchbox"), "airbnb");

    const row = screen.getByText("airbnb").closest("li");
    expect(within(row!).getByRole("link")).toHaveAttribute(
      "href",
      "/groups/g1/expenses/airbnb?cat=lodging&q=airbnb",
    );
  });

  it("carries them into a repayment's screen too", async () => {
    renderList();

    await userEvent.click(kind("Settlements"));

    const row = screen.getByText("Seb paid Padi").closest("li");
    expect(within(row!).getByRole("link")).toHaveAttribute(
      "href",
      "/groups/g1/settlements/s1?kind=settlement",
    );
  });

  it("puts the reader back down where they were picked up", async () => {
    fetchMock.mockResolvedValue(page([OLDER]));
    const cursor = "2026-08-12|2026-08-12T09:00:00.000000Z|s1";
    const { unmount } = renderList(ROWS, "", cursor);

    // A screenful further on than the server sent, and a long way down it.
    await reachBottom();
    await screen.findByText("Hôtel du Lac");
    scrolledTo(2400);

    await userEvent.click(screen.getByRole("link", { name: /Hôtel du Lac/ }));
    unmount();

    // The trip home: the same URL, and a list that starts again from the
    // server's first page.
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(page([OLDER]));
    renderList(ROWS, "", cursor);

    expect(await screen.findByText("Hôtel du Lac")).toBeVisible();
    // Exactly the row it is short of, rather than the bulk page a filter takes.
    const asked = new URL(fetchMock.mock.calls[0][0] as string, "http://test");
    expect(asked.searchParams.get("limit")).toBe("1");
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 2400,
      behavior: "instant",
    });
  });

  it("does not chase a position it does not need to", async () => {
    renderList(ROWS, "", null);
    scrolledTo(700);

    await userEvent.click(screen.getByRole("link", { name: /Migros/ }));
    renderList(ROWS, "", null);

    // Every row was already there, so nothing is fetched and the reader is
    // simply put back.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 700,
      behavior: "instant",
    });
  });

  it("stays at the top when the reader comes back to another list", async () => {
    renderList(ROWS, "?cat=lodging", null);
    scrolledTo(700);
    await userEvent.click(
      within(screen.getByText("airbnb").closest("li")!).getByRole("link"),
    );

    // Home to the same screen, but not to the same list: 700px down
    // "everything" is not the place 700px down "Lodging" was.
    renderList(ROWS, "", null);

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("spends the place, so the next arrival opens at the top", async () => {
    renderList(ROWS, "", null);
    scrolledTo(700);
    await userEvent.click(screen.getByRole("link", { name: /Migros/ }));

    renderList(ROWS, "", null);
    expect(window.scrollTo).toHaveBeenCalledTimes(1);

    // Arrived at again later — from the tab bar, from anywhere — this is a
    // reader asking for the list, not one returning to it.
    renderList(ROWS, "", null);
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("gets as far as it can when the list has ended short", async () => {
    fetchMock.mockResolvedValue(page([OLDER]));
    const cursor = "2026-08-12|2026-08-12T09:00:00.000000Z|s1";
    const { unmount } = renderList(ROWS, "", cursor);

    await reachBottom();
    await screen.findByText("Hôtel du Lac");
    scrolledTo(2400);
    await userEvent.click(screen.getByRole("link", { name: /Hôtel du Lac/ }));
    unmount();

    // Somebody deleted the hotel bill in the meantime: the list now ends where
    // the first page does, and the rows the offset was measured against are
    // never coming. Waiting for them would leave the reader at the top.
    fetchMock.mockReset();
    renderList(ROWS, "", null);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 2400,
      behavior: "instant",
    });
  });
});
