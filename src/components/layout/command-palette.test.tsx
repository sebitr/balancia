import type { MouseEvent, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { RowView } from "@/components/expenses/list-filter";
import type { NavigationGroup } from "@/modules/balances/navigation";
import type { PaletteResults } from "@/modules/search/service";

/**
 * The command palette: what it lists, how the keyboard moves through it, and
 * where each row goes.
 *
 * The server is `searchPaletteAction`, stubbed with an answer per query. A
 * `Link` is an anchor that records where it was followed to and stops there,
 * as Next's does once it has taken the click. The width is a desk's, so ⌘K
 * (Ctrl K, off a Mac) is answered.
 */
const followed = vi.hoisted(() => ({ hrefs: [] as string[] }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/groups/g1",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    transitionTypes,
    onClick,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    transitionTypes?: string[];
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a
      href={href}
      data-transition={transitionTypes?.join(" ")}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
        followed.hrefs.push(href);
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

const search = vi.hoisted(() => ({
  action: vi.fn(),
}));
vi.mock("@/modules/search/actions", () => ({
  searchPaletteAction: search.action,
}));

const { CommandPalette, openCommandPalette } =
  await import("./command-palette");

const LISBON: NavigationGroup = {
  id: "g1",
  name: "Lisbon, March",
  icon: null,
  iconColor: null,
  direction: "owes",
  amounts: [
    { minorUnits: "24800", currency: "EUR" },
    { minorUnits: "-6220", currency: "CHF" },
  ],
  lastActivityAt: "2026-08-12T10:00:00.000Z",
};

const BOOK_CLUB: NavigationGroup = {
  id: "g2",
  name: "Book club",
  icon: null,
  iconColor: null,
  direction: "owed",
  amounts: [{ minorUnits: "1250", currency: "EUR" }],
  lastActivityAt: "2026-08-11T10:00:00.000Z",
};

function row(overrides: Partial<RowView>): RowView {
  return {
    kind: "expense",
    id: "e1",
    date: "2025-08-12",
    title: "Dinner at Trattoria Il Ponte",
    amount: "12840",
    currency: "EUR",
    category: "restaurants",
    subcategory: null,
    note: null,
    position: "-2140",
    revenue: false,
    recurring: false,
    payers: ["p-amelie"],
    people: ["p-amelie", "p-me"],
    foreign: false,
    receipt: false,
    receipts: 0,
    payerNames: ["Amélie"],
    split: { method: "equal", sharers: ["p-amelie", "p-me"] },
    method: null,
    ...overrides,
  };
}

const EMPTY: PaletteResults = {
  groups: [LISBON, BOOK_CLUB],
  people: [],
  entries: null,
};

const DINNER: PaletteResults = {
  groups: [],
  people: [
    {
      id: "p-dina",
      name: "Dina",
      groupId: "g2",
      groupName: "Book club",
    },
  ],
  entries: {
    groupId: "g1",
    groupName: "Lisbon, March",
    self: "p-me",
    rows: [
      row({}),
      row({
        kind: "settlement",
        id: "s1",
        title: "Jonas paid Amélie",
        amount: "12000",
        category: null,
        payers: ["p-jonas"],
        payerNames: ["Jonas"],
        split: null,
      }),
    ],
  },
};

function answer(byQuery: Record<string, PaletteResults>) {
  search.action.mockImplementation(
    async ({ query }: { query: string; groupId: string | null }) => ({
      ok: true,
      data: byQuery[query.trim().toLowerCase()] ?? {
        groups: [],
        people: [],
        entries: null,
      },
    }),
  );
}

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: query === "(min-width: 64rem)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  answer({ "": EMPTY, din: DINNER });
});

afterEach(() => {
  // Close whatever a test left open, so the next one starts shut.
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  cleanup();
  search.action.mockReset();
  followed.hrefs = [];
  document.cookie = "balancia_single_keys=; path=/; max-age=0";
});

function renderPalette({
  group = { id: "g1", name: "Lisbon, March" },
  isGuest = false,
  sidebar,
}: {
  group?: { id: string; name: string } | null;
  isGuest?: boolean;
  sidebar?: ReactNode;
} = {}) {
  renderWithIntl(
    <>
      {sidebar}
      <CommandPalette group={group} isGuest={isGuest} />
    </>,
  );
}

async function openWithKeys(name = "Search or jump to") {
  await userEvent.keyboard("{Control>}k{/Control}");
  const dialog = await screen.findByRole("dialog", { name });
  // The first answer, for the empty field.
  await waitFor(() => expect(search.action).toHaveBeenCalled());
  return dialog;
}

function field() {
  return screen.getByRole("combobox", {
    name: "Search groups, people and transactions",
  });
}

function activeOption() {
  const id = field().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
}

describe("CommandPalette", () => {
  it("opens on ⌘K with the focus in its field, and lists the groups and what this screen offers", async () => {
    renderPalette();
    const dialog = await openWithKeys();

    expect(field()).toHaveFocus();
    expect(search.action).toHaveBeenCalledWith({ query: "", groupId: "g1" });

    const groups = within(dialog).getByRole("group", { name: "Groups" });
    const lisbon = await within(groups).findByRole("option", {
      // Where the reader stands, in the sidebar's words, one per currency.
      name: /^Lisbon, March, you are owed €248\.00, you owe CHF\s62\.20$/,
    });
    expect(lisbon).toHaveAttribute("href", "/groups/g1");
    // The first row is the one ↵ follows.
    expect(lisbon).toHaveAttribute("aria-selected", "true");
    expect(activeOption()).toBe(lisbon);

    // Each phrase in its tone's ink, never the accent — which lights only the
    // tile of the group the reader is in, as the sidebar does.
    const owed = within(lisbon).getByText("you are owed €248.00");
    const owe = within(lisbon).getByText(/you owe CHF/);
    expect(owed).toHaveClass("text-positive-ink");
    expect(owe).toHaveClass("text-negative-ink");
    expect(owed.className + owe.className).not.toMatch(/primary/);

    const actions = within(dialog).getByRole("group", { name: "Actions" });
    expect(
      within(actions)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Add an expense to Lisbon, MarchN",
      "Settle up in Lisbon, MarchS",
      "Open settings",
    ]);
    expect(
      within(actions).getByRole("option", { name: /Settle up/ }),
    ).toHaveAttribute("href", "/groups/g1/settle");
    expect(
      within(actions).getByRole("option", { name: "Open settings" }),
    ).toHaveAttribute("href", "/settings");
  });

  it("finds a group as it is typed, before the server has answered", async () => {
    renderPalette();
    const dialog = await openWithKeys();
    await within(dialog).findByRole("option", { name: /^Book club/ });

    search.action.mockImplementation(() => new Promise(() => {}));
    await userEvent.type(field(), "book");

    const groups = within(dialog).getByRole("group", { name: "Groups" });
    expect(
      within(groups)
        .getAllByRole("option")
        .map((option) => option.getAttribute("href")),
    ).toEqual(["/groups/g2"]);
  });

  it("lists the group's transactions and the people that match, and says how many", async () => {
    renderPalette();
    const dialog = await openWithKeys();
    await userEvent.type(field(), "din");

    const entries = await within(dialog).findByRole("group", {
      name: "Transactions in Lisbon, March",
    });
    expect(search.action).toHaveBeenLastCalledWith({
      query: "din",
      groupId: "g1",
    });

    const dinner = within(entries).getByRole("option", {
      name: /Dinner at Trattoria Il Ponte/,
    });
    expect(dinner).toHaveAttribute("href", "/groups/g1/expenses/e1");
    // Last year's, so with its year, in the default notation.
    expect(dinner).toHaveTextContent("Aug 12, 2025 · Amélie paid");
    // The entry's total, in neutral ink: it is not where anybody stands.
    const total = within(dinner).getByText("€128.40");
    expect(total.className).not.toMatch(/positive|negative|primary/);

    const repayment = within(entries).getByRole("option", {
      name: /Jonas paid Amélie/,
    });
    expect(repayment).toHaveAttribute("href", "/groups/g1/settlements/s1");
    expect(within(repayment).getByText("Repayment")).toBeInTheDocument();

    const people = within(dialog).getByRole("group", { name: "People" });
    expect(
      within(people).getByRole("option", { name: /Dina/ }),
    ).toHaveAttribute("href", "/groups/g2/members/p-dina");
    expect(within(people).getByText("Book club")).toBeInTheDocument();

    expect(screen.getByRole("status")).toHaveTextContent("3 results");
  });

  it("moves with ↑ and ↓, and follows the row with ↵", async () => {
    renderPalette();
    const dialog = await openWithKeys();
    await within(dialog).findByRole("option", { name: /^Book club/ });

    await userEvent.keyboard("{ArrowDown}");
    expect(activeOption()).toHaveAttribute("href", "/groups/g2");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    // Round from the top to the last row.
    expect(activeOption()).toHaveTextContent("Open settings");

    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(followed.hrefs).toEqual(["/groups/g1"]);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Search or jump to" }),
      ).toBeNull(),
    );
  });

  it("opens a row in a new tab with Ctrl ↵, and stays open", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderPalette();
    const dialog = await openWithKeys();
    await within(dialog).findByRole("option", { name: /^Book club/ });

    await userEvent.keyboard("{ArrowDown}{Control>}{Enter}{/Control}");
    expect(open).toHaveBeenCalledWith(
      "http://localhost:3000/groups/g2",
      "_blank",
      "noopener,noreferrer",
    );
    expect(followed.hrefs).toEqual([]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Esc", async () => {
    renderPalette();
    await openWithKeys();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says when nothing matches, and offers what still does", async () => {
    renderPalette();
    const dialog = await openWithKeys();
    await userEvent.type(field(), "settle");

    // On the screen, and said through the field's status line.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "No group, person or transaction matches “settle”.",
      ),
    );
    expect(
      within(dialog).getAllByText(
        "No group, person or transaction matches “settle”.",
      ),
    ).toHaveLength(2);
    const actions = within(dialog).getByRole("group", { name: "Actions" });
    expect(
      within(actions)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Settle up in Lisbon, MarchS"]);
  });

  it("says when the search could not be made", async () => {
    search.action.mockResolvedValue({
      ok: false,
      error: "Something went wrong on the server. Nothing was changed.",
    });
    renderPalette();
    const dialog = await openWithKeys();
    expect(
      await within(dialog).findByText(
        "Something went wrong on the server. Nothing was changed.",
      ),
    ).toBeInTheDocument();
  });

  it("adds an expense the way N does: the sidebar's own Add, once the palette has gone", async () => {
    const add = vi.fn();
    renderPalette({
      group: null,
      sidebar: (
        <header data-slot="app-sidebar">
          <button type="button" data-shortcut="n" onClick={add}>
            Add expense
          </button>
        </header>
      ),
    });
    const dialog = await openWithKeys();
    // The key is a hint for the eye; the option says it as a shortcut.
    const option = await within(dialog).findByRole("option", {
      name: "Add an expense",
    });
    expect(option).toHaveAttribute("aria-keyshortcuts", "N");
    expect(option.tagName).toBe("BUTTON");

    await userEvent.click(option);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("drops the N and S hints when the device has single keys off", async () => {
    document.cookie = "balancia_single_keys=off; path=/";
    renderPalette();
    const dialog = await openWithKeys();

    const actions = await within(dialog).findByRole("group", {
      name: "Actions",
    });
    expect(
      within(actions)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Add an expense to Lisbon, March",
      "Settle up in Lisbon, March",
      "Open settings",
    ]);
  });

  it("searches a guest's one group, with no list of groups and no settings", async () => {
    answer({ "": { groups: [], people: [], entries: null } });
    renderPalette({ isGuest: true });
    const dialog = await openWithKeys("Search this group");

    expect(
      within(dialog).getByRole("combobox", { name: "Search this group" }),
    ).toHaveFocus();
    expect(within(dialog).queryByRole("group", { name: "Groups" })).toBeNull();
    expect(
      within(dialog).queryByRole("option", { name: "Open settings" }),
    ).toBeNull();
  });

  it("is opened by the sidebar's Search as well", async () => {
    renderPalette();
    act(() => openCommandPalette());
    expect(
      await screen.findByRole("dialog", { name: "Search or jump to" }),
    ).toBeInTheDocument();
  });
});
