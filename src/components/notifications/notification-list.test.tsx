import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { NotificationList, type InboxRow } from "./notification-list";

/**
 * The inbox as it is actually operated.
 *
 * The arithmetic behind the list is tested in `grouping.test.ts`; what is
 * asserted here is the part a person touches — that a row opens the thing it
 * is about, that reading one changes the count beside the filter, and that the
 * swipe has a way through for somebody who is not holding a phone.
 */

const { push, refresh, markReadAction, setGroupSnoozedAction, toastUndoable } =
  vi.hoisted(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
    markReadAction: vi.fn(),
    setGroupSnoozedAction: vi.fn(),
    toastUndoable: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));
vi.mock("@/modules/notifications/actions", () => ({
  markReadAction,
  setGroupMutedAction: vi.fn().mockResolvedValue({ ok: true }),
  setGroupSnoozedAction,
}));
vi.mock("@/components/ui/sonner", () => ({
  toastUndoable,
  UNDO_WINDOW: 8000,
}));

const NOW = "2026-08-24T18:00:00.000Z";

let counter = 0;

function row(overrides: Partial<InboxRow> = {}): InboxRow {
  counter += 1;
  return {
    id: `n${counter}`,
    type: "expense.created",
    groupId: "chalet",
    groupName: "Chalet",
    entityId: `e${counter}`,
    actor: "Hervé",
    subject: "Raclette",
    title: "",
    sentence: `Hervé added Raclette ${counter}`,
    amount: "CHF 25.00",
    url: `/groups/chalet/expenses/e${counter}`,
    createdAt: "2026-08-24T08:00:00.000Z",
    day: "today",
    read: false,
    ...overrides,
  };
}

function renderInbox(items: InboxRow[], archived: never[] = []) {
  push.mockReset();
  refresh.mockReset();
  markReadAction.mockReset();
  markReadAction.mockResolvedValue({ ok: true });
  setGroupSnoozedAction.mockReset();
  setGroupSnoozedAction.mockResolvedValue({ ok: true });
  toastUndoable.mockReset();

  const view = renderWithIntl(
    <NotificationList items={items} archived={archived} now={NOW} quiet={[]} />,
  );
  return { ...view, user: userEvent.setup() };
}

describe("opening a notification", () => {
  it("marks it read on the way and goes where it points", async () => {
    const only = row();
    const { user } = renderInbox([only]);

    await user.click(screen.getByRole("button", { name: /Hervé added/ }));

    expect(markReadAction).toHaveBeenCalledWith([only.id]);
    expect(push).toHaveBeenCalledWith(only.url);
  });

  /** A row already read must not spend a write saying so again. */
  it("writes nothing when the row was already read", async () => {
    const { user } = renderInbox([row({ read: true })]);

    await user.click(screen.getByRole("button", { name: /Hervé added/ }));

    expect(markReadAction).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalled();
  });
});

describe("the counts beside the filters", () => {
  it("names how many are unread", () => {
    renderInbox([row(), row(), row({ read: true })]);

    expect(
      screen.getByRole("button", { name: "Unread 2" }),
    ).toBeInTheDocument();
  });

  /** Reading one is the count going down: the badge tracks what was looked at. */
  it("comes down as rows are opened", async () => {
    const { user } = renderInbox([row(), row()]);

    await user.click(
      screen.getAllByRole("button", { name: /Hervé added/ })[0]!,
    );

    expect(
      screen.getByRole("button", { name: "Unread 1" }),
    ).toBeInTheDocument();
  });

  /** Zero is not worth printing; the label alone says what the filter is. */
  it("drops the number when there is nothing left", () => {
    renderInbox([row({ read: true })]);

    expect(screen.getByRole("button", { name: "Unread" })).toBeInTheDocument();
  });
});

describe("narrowing to one kind", () => {
  it("shows only what the chosen filter admits", async () => {
    const { user } = renderInbox([row(), row({ read: true })]);

    await user.click(screen.getByRole("button", { name: "Unread 1" }));

    expect(screen.getAllByRole("button", { name: /Hervé added/ })).toHaveLength(
      1,
    );
  });

  /** An empty filter explains itself rather than showing a blank column. */
  it("says why a filter is empty", async () => {
    const { user } = renderInbox([row()]);

    await user.click(screen.getByRole("button", { name: "Reminders" }));

    expect(screen.getByText("No reminders")).toBeInTheDocument();
  });
});

describe("a run of changes to one expense", () => {
  const burst = () => [
    row({
      entityId: "jardinier",
      subject: "jardinier",
      type: "expense.deleted",
      amount: null,
    }),
    row({
      entityId: "jardinier",
      subject: "jardinier",
      type: "expense.updated",
    }),
    row({ entityId: "jardinier", subject: "jardinier" }),
  ];

  it("folds into one line naming who and how many", () => {
    renderInbox(burst());

    expect(
      screen.getByRole("button", { name: /Hervé made 3 changes to jardinier/ }),
    ).toBeInTheDocument();
  });

  it("opens to the individual changes, and marks them read", async () => {
    const rows = burst();
    const { user } = renderInbox(rows);

    await user.click(
      screen.getByRole("button", { name: /Hervé made 3 changes/ }),
    );

    expect(screen.getByText(rows[1]!.sentence)).toBeInTheDocument();
    expect(markReadAction).toHaveBeenCalledWith(rows.map((one) => one.id));
  });
});

describe("finished imports", () => {
  const anImport = (over: Partial<InboxRow> = {}) =>
    row({
      type: "import.completed",
      actor: null,
      entityId: null,
      amount: null,
      sentence: "Import finished: 12 added, 0 skipped, 0 not imported",
      url: "/groups/chalet/expenses",
      ...over,
    });

  /** One is a row that opens the group, not a thing to unfold. */
  it("opens the group's expenses when there is only one", async () => {
    const { user } = renderInbox([anImport()]);

    await user.click(screen.getByRole("button", { name: /Import finished/ }));

    expect(push).toHaveBeenCalledWith("/groups/chalet/expenses");
  });

  it("gathers several into a count that opens", async () => {
    const { user } = renderInbox([anImport(), anImport()]);

    const digest = screen.getByRole("button", { name: /2 imports finished/ });
    expect(digest).toHaveAttribute("aria-expanded", "false");

    await user.click(digest);
    expect(digest).toHaveAttribute("aria-expanded", "true");
  });
});

describe("a reminder", () => {
  const reminder = () =>
    row({
      type: "reminder.received",
      entityId: null,
      title: "CHF 33.34 from Multi currency",
      sentence: "Ce rappel s’autodétruira dès que 33,34 CHF atteindront Cyril.",
      amount: null,
      url: "/groups/chalet",
    });

  /** The sender's own words, reproduced and never translated. */
  it("shows the message as it was written", () => {
    const one = reminder();
    renderInbox([one]);

    expect(screen.getByText(one.sentence)).toBeInTheDocument();
  });

  it("sends Settle up to the screen that lists the balances", async () => {
    const { user } = renderInbox([reminder()]);

    await user.click(screen.getByRole("button", { name: "Settle up" }));

    expect(push).toHaveBeenCalledWith("/groups/chalet/settle");
  });
});

describe("getting rid of a row without a phone", () => {
  /**
   * The swipe is the gesture; this is the same action for anyone tabbing
   * through. Hidden until it takes focus, because sixteen visible Dismiss
   * buttons would be a different screen.
   */
  it("offers a Dismiss button that takes the row away", async () => {
    const { user } = renderInbox([row(), row()]);

    await user.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);

    expect(screen.getAllByRole("button", { name: /Hervé added/ })).toHaveLength(
      1,
    );
  });

  it("confirms with a way back that restores it", async () => {
    const { user } = renderInbox([row()]);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(toastUndoable).toHaveBeenCalled();

    await userEvent.setup();
    toastUndoable.mock.calls.at(-1)![1].onUndo();

    expect(
      await screen.findByRole("button", { name: /Hervé added/ }),
    ).toBeInTheDocument();
  });
});

describe("quietening a group from its chip", () => {
  it("offers the group's options without opening the row", async () => {
    const { user } = renderInbox([row()]);

    await user.click(
      screen.getByRole("button", { name: "Options for Chalet" }),
    );

    expect(push).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Snooze for 24 hours/ }),
    ).toBeInTheDocument();
  });

  it("snoozes for a day and says so on the list", async () => {
    const { user } = renderInbox([row()]);

    await user.click(
      screen.getByRole("button", { name: "Options for Chalet" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Snooze for 24 hours/ }),
    );

    expect(setGroupSnoozedAction).toHaveBeenCalledWith("chalet", 24);
    expect(screen.getByText(/Chalet is snoozed/)).toBeInTheDocument();
    // Suppressed everywhere, counts included, or the badge cannot be cleared.
    expect(screen.getByRole("button", { name: "Unread" })).toBeInTheDocument();
  });
});

describe("the day a row belongs to", () => {
  it("heads each section and leaves out the empty ones", () => {
    renderInbox([row(), row({ day: "earlier" })]);

    // Uppercased by CSS, which jsdom does not run — the text itself is not.
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((one) => one.textContent)).toEqual([
      "Today",
      "Earlier",
    ]);
  });
});

describe("naming the group", () => {
  it("prints the chip once for a run and again when it changes", () => {
    renderInbox([
      row({ groupId: "chalet", groupName: "Chalet" }),
      row({ groupId: "chalet", groupName: "Chalet" }),
      row({ groupId: "multi", groupName: "Multi currency" }),
    ]);

    expect(
      screen
        .getAllByRole("button", { name: /^Options for/ })
        .map((one) => one.getAttribute("aria-label")),
    ).toEqual(["Options for Chalet", "Options for Multi currency"]);
  });
});

describe("the archive", () => {
  const old = {
    id: "a1",
    groupName: "Chalet",
    sentence: "Hervé added Fondue · CHF 62.00",
    amount: "CHF 62.00",
    createdAt: "2026-07-01T08:00:00.000Z",
    url: "/groups/chalet/expenses/old",
  };

  it("keeps old read rows behind a footer that opens", async () => {
    const { user } = renderInbox([row()], [old] as never);

    expect(screen.queryByText(/Fondue/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Archive/ }));

    expect(
      within(
        screen.getByRole("button", { name: /Chalet, Hervé added Fondue/ }),
      ).getByText(/Fondue/),
    ).toBeInTheDocument();
  });

  /** It is the whole list's footer, so it has no place under a narrowed one. */
  it("stays out of the way on the other filters", async () => {
    const { user } = renderInbox([row()], [old] as never);

    await user.click(screen.getByRole("button", { name: "Unread 1" }));

    expect(screen.queryByRole("button", { name: /Archive/ })).toBeNull();
  });
});
