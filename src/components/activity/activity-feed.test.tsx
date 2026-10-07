import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator } from "use-intl/core";
import en from "../../../messages/en.json";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { createDateFormatter } from "@/i18n/format";
import type { ActivityEntry } from "@/modules/activity/service";
import { ActivityFeed } from "./activity-feed";

/**
 * The group's history: the clock it tells the time on, and the Restore it
 * carries on a deletion that still stands — the way back that does not run
 * out after eight seconds.
 *
 * The feed renders on the server; here it is awaited and its output mounted,
 * with the real English catalogue behind both halves — the whole of it for the
 * server's, and for the browser's only what the group area's provider carries,
 * which is all the Restore button is handed on the Activity screen. Given the
 * whole catalogue, these tests passed while that provider did not carry
 * `activity.restore`, and the button printed its keys in the app. The server
 * is the boundary: the restores are mocked, and what is asserted is what the
 * row does with their answer.
 */

// The feed asks for exactly one namespace, which is all this answers.
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "activity") =>
    createTranslator({ locale: "en", messages: en, namespace }),
  getLocale: async () => "en",
}));

/*
 * The server's formatter, UTC and all. The app's own zone is the server's —
 * UTC unless an operator set `TZ` — which is exactly the situation the feed
 * has to correct for by telling each time on the group's clock.
 */
vi.mock("@/i18n/preferences", () => ({
  getDateFormatter: async () =>
    createDateFormatter({
      dateFormat: "dmy",
      formatLocale: "en-GB",
      timeZone: "UTC",
    }),
  getNumberLocale: async () => "en-GB",
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
}));

type ById = (
  groupId: string,
  id: string,
) => Promise<{ ok: boolean; error?: string }>;

const {
  restoreExpenseAction,
  restoreSettlementAction,
  restoreRecurringAction,
  restoreParticipantAction,
} = vi.hoisted(() => ({
  restoreExpenseAction: vi.fn<ById>(async () => ({ ok: true })),
  restoreSettlementAction: vi.fn<ById>(async () => ({ ok: true })),
  restoreRecurringAction: vi.fn<ById>(async () => ({ ok: true })),
  restoreParticipantAction: vi.fn<ById>(async () => ({ ok: true })),
}));

vi.mock("@/modules/expenses/actions", () => ({
  restoreExpenseAction,
  restoreSettlementAction,
}));
vi.mock("@/modules/recurring/actions", () => ({ restoreRecurringAction }));
vi.mock("@/modules/groups/actions", () => ({ restoreParticipantAction }));

const success = vi.fn();
const error = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    error: (...args: unknown[]) => error(...args),
  },
}));

function event(
  fields: Pick<ActivityEntry, "id" | "action" | "entityType"> &
    Partial<ActivityEntry>,
): ActivityEntry {
  return {
    entityId: null,
    metadata: null,
    actorLabel: "Ada",
    actorType: "user",
    actorParticipantId: "p-ada",
    createdAt: new Date("2026-09-01T10:00:00Z"),
    ...fields,
  };
}

const DINNER_DELETED = event({
  id: "a1",
  action: "expense.deleted",
  entityType: "expense",
  entityId: "e1",
  metadata: { description: "Dinner", amount: "3000", currency: "EUR" },
});

const REPAYMENT_DELETED = event({
  id: "a2",
  action: "settlement.deleted",
  entityType: "settlement",
  entityId: "s1",
  metadata: { amount: "2000", currency: "EUR" },
});

const RENT_DELETED = event({
  id: "a3",
  action: "recurring.deleted",
  entityType: "recurring_expense",
  entityId: "r1",
  metadata: { description: "Rent" },
});

/** Deleted, and put back since: the server no longer lists it. */
const TAXI_DELETED = event({
  id: "a4",
  action: "expense.deleted",
  entityType: "expense",
  entityId: "e2",
  metadata: { description: "Taxi", amount: "1200", currency: "EUR" },
});

const LUNCH_ADDED = event({
  id: "a5",
  action: "expense.created",
  entityType: "expense",
  entityId: "e3",
  metadata: { description: "Lunch" },
});

const ENTRIES = [
  DINNER_DELETED,
  REPAYMENT_DELETED,
  RENT_DELETED,
  TAXI_DELETED,
  LUNCH_ADDED,
];

async function feed(restorable: readonly string[]) {
  return ActivityFeed({
    entries: ENTRIES,
    groupId: "g1",
    restorable: new Set(restorable),
    timeZone: "UTC",
  });
}

/** Where the Activity screen renders: under the group layout's provider. */
const GROUP = { area: "group" } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the activity feed's clock", () => {
  const ADDED = event({
    id: "a1",
    action: "expense.created",
    entityType: "expense",
    entityId: "e1",
    metadata: { description: "Groceries" },
    // Five past two in the afternoon in UTC; five past four in Paris, which is
    // on summer time in August.
    createdAt: new Date("2026-08-13T14:05:00Z"),
  });

  it("tells the time on the group's clock, not the server's", async () => {
    renderWithIntl(
      await ActivityFeed({
        entries: [ADDED],
        groupId: "g1",
        restorable: new Set(),
        timeZone: "Europe/Paris",
      }),
      GROUP,
    );

    const time = screen.getByText(/16:05/);
    expect(time).toHaveTextContent("13/08/2026, 16:05");
    // The machine-readable instant is still the instant.
    expect(time).toHaveAttribute("datetime", "2026-08-13T14:05:00.000Z");
    expect(screen.queryByText(/14:05/)).not.toBeInTheDocument();
  });

  it("moves the day with the clock", async () => {
    // A quarter to midnight in UTC is already tomorrow in Auckland.
    renderWithIntl(
      await ActivityFeed({
        entries: [{ ...ADDED, createdAt: new Date("2026-08-13T23:45:00Z") }],
        groupId: "g1",
        restorable: new Set(),
        timeZone: "Pacific/Auckland",
      }),
      GROUP,
    );

    expect(screen.getByText(/11:45/)).toHaveTextContent("14/08/2026, 11:45");
  });
});

describe("a repayment in the feed", () => {
  it("says who paid whom and how much, and calls the reader you", async () => {
    renderWithIntl(
      await ActivityFeed({
        entries: [
          event({
            id: "r1",
            action: "settlement.created",
            entityType: "settlement",
            entityId: "s1",
            actorLabel: "Sam",
            actorParticipantId: "p-sam",
            metadata: {
              amount: "3000",
              currency: "EUR",
              from: "p-sam",
              to: "p-ada",
            },
          }),
        ],
        groupId: "g1",
        restorable: new Set(),
        timeZone: "UTC",
        people: {
          you: "p-ada",
          names: new Map([
            ["p-sam", "Sam"],
            ["p-ada", "Ada"],
          ]),
        },
      }),
      GROUP,
    );

    expect(screen.getByText("Sam")).toBeVisible();
    expect(
      screen.getByText("recorded their repayment of €30.00 to you"),
    ).toBeVisible();
  });
});

/**
 * Who is named, and by what name.
 *
 * A run of lines by one person once named them on the first and left the rest
 * a verb with no subject — "recorded Sam's repayment", "edited an expense" —
 * which read as names missing. And the name printed was the label the event
 * had kept, the one on the person's account, rather than the one the group
 * knows them by.
 */
describe("who each line names", () => {
  const NAMES = new Map([
    ["p-ada", "Ada"],
    ["p-sam", "Sam"],
  ]);

  // Read by Sam, so that "you" is the one the lines say it of.
  const lines = (entries: ActivityEntry[]) =>
    ActivityFeed({
      entries,
      groupId: "g1",
      restorable: new Set(),
      timeZone: "UTC",
      people: { you: "p-sam", names: NAMES },
    });

  it("names the person on every line of a run, not just the first", async () => {
    renderWithIntl(
      await lines([
        event({
          id: "n1",
          action: "expense.created",
          entityType: "expense",
          entityId: "e1",
          metadata: { description: "Lunch", amount: "1200", currency: "EUR" },
        }),
        event({
          id: "n2",
          action: "expense.created",
          entityType: "expense",
          entityId: "e2",
          metadata: { description: "Taxi", amount: "800", currency: "EUR" },
        }),
      ]),
      GROUP,
    );

    const names = screen.getAllByText("Ada");
    expect(names).toHaveLength(2);
    for (const name of names) {
      expect(name).toBeVisible();
      expect(name.className).not.toContain("sr-only");
    }
  });

  it("prints the name the group has for them, not the label the event kept", async () => {
    renderWithIntl(
      await lines([
        event({
          id: "n1",
          action: "expense.created",
          entityType: "expense",
          entityId: "e1",
          actorLabel: "Ada Lovelace-Byron",
          metadata: { description: "Lunch", amount: "1200", currency: "EUR" },
        }),
      ]),
      GROUP,
    );

    expect(screen.getByText("Ada")).toBeVisible();
    expect(screen.queryByText(/Lovelace/)).toBeNull();
  });

  it("names somebody whose event kept no label, instead of 'Someone'", async () => {
    renderWithIntl(
      await lines([
        event({
          id: "n1",
          action: "expense.created",
          entityType: "expense",
          entityId: "e1",
          actorLabel: null,
          metadata: { description: "Lunch", amount: "1200", currency: "EUR" },
        }),
      ]),
      GROUP,
    );

    expect(screen.getByText("Ada")).toBeVisible();
    expect(screen.queryByText("Someone")).toBeNull();
  });

  it("tells a change of type as the one line it was", async () => {
    renderWithIntl(
      await lines([
        event({
          id: "n1",
          action: "settlement.created",
          entityType: "settlement",
          entityId: "s1",
          metadata: {
            amount: "3000",
            currency: "EUR",
            from: "p-sam",
            to: "p-ada",
          },
          replaces: {
            action: "expense.deleted",
            entityType: "expense",
            entityId: "e1",
            metadata: { description: "Dinner", replacedBy: "s1" },
          },
        }),
      ]),
      GROUP,
    );

    expect(
      screen.getByText("turned “Dinner” into your repayment of €30.00 to Ada"),
    ).toBeVisible();
    expect(screen.queryByText(/deleted/)).toBeNull();
    // Nothing to put back: the entry was replaced, not lost.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("restoring from the activity feed", () => {
  it("offers a restore only on deletions that still stand", async () => {
    renderWithIntl(await feed(["a1", "a2", "a3"]), GROUP);

    // Each one named for what it puts back, starting with the word it shows.
    expect(
      screen.getByRole("button", { name: "Restore the expense “Dinner”" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Restore the repayment of €20.00" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Restore the recurring expense “Rent”",
      }),
    ).toBeVisible();

    // Taxi was put back already, and a new expense has nothing to restore.
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Taxi/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Lunch/ })).toBeNull();
  });

  it("calls the restore for the kind and the entry the row names", async () => {
    const user = userEvent.setup();
    renderWithIntl(await feed(["a1", "a2", "a3"]), GROUP);

    await user.click(
      screen.getByRole("button", { name: "Restore the repayment of €20.00" }),
    );
    expect(restoreSettlementAction).toHaveBeenCalledWith("g1", "s1");

    await user.click(
      screen.getByRole("button", {
        name: "Restore the recurring expense “Rent”",
      }),
    );
    expect(restoreRecurringAction).toHaveBeenCalledWith("g1", "r1");

    await user.click(
      screen.getByRole("button", { name: "Restore the expense “Dinner”" }),
    );
    expect(restoreExpenseAction).toHaveBeenCalledWith("g1", "e1");
  });

  it("can be reached and pressed from the keyboard", async () => {
    const user = userEvent.setup();
    renderWithIntl(await feed(["a1"]), GROUP);

    await user.tab();
    const button = screen.getByRole("button", {
      name: "Restore the expense “Dinner”",
    });
    expect(button).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(restoreExpenseAction).toHaveBeenCalledWith("g1", "e1");
  });

  /**
   * No toast: the row changes under the finger that pressed it, which is the
   * confirmation. The word that replaces the button takes its focus, so a
   * keyboard is not dropped at the top of the page.
   */
  it("goes quiet once it has worked, and leaves the focus on the row", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(await feed(["a1"]), GROUP);

    await user.click(
      screen.getByRole("button", { name: "Restore the expense “Dinner”" }),
    );

    await waitFor(() => expect(screen.getByText("Restored")).toHaveFocus());
    expect(screen.queryByRole("button")).toBeNull();
    expect(refresh).toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    // The refresh brings the page back without Dinner among the deletions
    // still standing. The row keeps its word, and the word keeps the focus.
    rerender(await feed([]));
    expect(screen.getByText("Restored")).toHaveFocus();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says why when the restore is refused, and keeps the button", async () => {
    restoreExpenseAction.mockResolvedValueOnce({
      ok: false,
      error: "That expense is not part of this group.",
    });
    const user = userEvent.setup();
    renderWithIntl(await feed(["a1"]), GROUP);

    const button = screen.getByRole("button", {
      name: "Restore the expense “Dinner”",
    });
    await user.click(button);

    expect(error).toHaveBeenCalledWith(
      "That expense is not part of this group.",
    );
    expect(success).not.toHaveBeenCalled();
    expect(screen.queryByText("Restored")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Restore the expense “Dinner”" }),
    ).toBeVisible();
    // And asks the server what is true now, in case somebody else put it back.
    expect(refresh).toHaveBeenCalled();
  });

  /**
   * The button's name is written on the server, from the whole catalogue, and
   * would read correctly with nothing in the browser at all. Its three words —
   * the one it shows, the refusal it falls back on, the one it turns into —
   * are read in the browser, from the group's provider.
   */
  it("finds its own words in what the group's provider carries", async () => {
    restoreExpenseAction.mockResolvedValueOnce({ ok: false });
    const user = userEvent.setup();
    renderWithIntl(await feed(["a1"]), GROUP);

    const button = screen.getByRole("button", {
      name: "Restore the expense “Dinner”",
    });
    expect(button).toHaveTextContent(/^Restore$/);

    await user.click(button);
    expect(error).toHaveBeenCalledWith("It could not be put back. Try again.");

    await user.click(button);
    await waitFor(() => expect(screen.getByText("Restored")).toHaveFocus());
  });

  it("does not send a second restore while the first is out", async () => {
    let settle: (value: { ok: boolean }) => void = () => {};
    restoreExpenseAction.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const user = userEvent.setup();
    renderWithIntl(await feed(["a1"]), GROUP);

    const button = screen.getByRole("button", {
      name: "Restore the expense “Dinner”",
    });
    await user.click(button);
    await user.click(button);

    expect(restoreExpenseAction).toHaveBeenCalledTimes(1);
    // Still the focused control while it waits: marked busy, not disabled.
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();

    settle({ ok: true });
    await waitFor(() => expect(screen.getByText("Restored")).toHaveFocus());
  });
});

const BOB_REMOVED = event({
  id: "b1",
  action: "participant.removed",
  entityType: "participant",
  entityId: "p-bob",
  metadata: { displayName: "Bob" },
});

/** Removed, and put back since: the server no longer lists it. */
const CAROL_REMOVED = event({
  id: "b2",
  action: "participant.removed",
  entityType: "participant",
  entityId: "p-carol",
  metadata: { displayName: "Carol" },
});

/**
 * About a person, but not a removal. Listed as restorable all the same, which
 * the server never does, to show that the row's own action decides whether a
 * button can go on it at all.
 */
const DAN_ADDED = event({
  id: "b3",
  action: "participant.created",
  entityType: "participant",
  entityId: "p-dan",
  metadata: { displayName: "Dan" },
});

async function people(restorable: readonly string[]) {
  return ActivityFeed({
    entries: [BOB_REMOVED, CAROL_REMOVED, DAN_ADDED],
    groupId: "g1",
    restorable: new Set(restorable),
    timeZone: "UTC",
  });
}

/**
 * A person taken out of the group comes back from the line that took them
 * out, through the same restore the People screen's toast offers — the way
 * back that does not run out after eight seconds.
 */
describe("putting a removed person back from the activity feed", () => {
  it("offers it only on a removal whose person is still removed", async () => {
    renderWithIntl(await people(["b1", "b3"]), GROUP);

    // Named for who it puts back, starting with the word it shows.
    const button = screen.getByRole("button", {
      name: "Restore Bob to the group",
    });
    expect(button).toBeVisible();
    expect(button).toHaveTextContent(/^Restore$/);

    // Carol is back already, and adding Dan is nothing to undo.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Carol/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Dan/ })).toBeNull();
  });

  it("offers nothing where the server lists nothing — a reader who may not restore", async () => {
    renderWithIntl(await people([]), GROUP);

    // The removal is still told; only the button is not there.
    expect(screen.getByText("removed Bob from the group")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("can be reached from the keyboard, and puts back the person the row names", async () => {
    const user = userEvent.setup();
    renderWithIntl(await people(["b1"]), GROUP);

    await user.tab();
    expect(
      screen.getByRole("button", { name: "Restore Bob to the group" }),
    ).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(restoreParticipantAction).toHaveBeenCalledWith("g1", "p-bob");
    expect(restoreExpenseAction).not.toHaveBeenCalled();
  });

  /**
   * No toast: the row says so, under the finger that pressed it, which is the
   * doctrine at `toastUndoable`. The People screen's own Undo does still toast,
   * from the toast it lives on; that one is not this.
   */
  it("goes quiet once they are back, and leaves the focus on the row", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(await people(["b1"]), GROUP);

    await user.click(
      screen.getByRole("button", { name: "Restore Bob to the group" }),
    );

    await waitFor(() => expect(screen.getByText("Restored")).toHaveFocus());
    expect(screen.queryByRole("button")).toBeNull();
    expect(refresh).toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    // The refresh comes back with Bob no longer removed.
    rerender(await people([]));
    expect(screen.getByText("Restored")).toHaveFocus();
  });

  it("says why when putting them back is refused, and keeps the button", async () => {
    restoreParticipantAction.mockResolvedValueOnce({
      ok: false,
      error: "That item is not part of this group.",
    });
    const user = userEvent.setup();
    renderWithIntl(await people(["b1"]), GROUP);

    await user.click(
      screen.getByRole("button", { name: "Restore Bob to the group" }),
    );

    expect(error).toHaveBeenCalledWith("That item is not part of this group.");
    expect(success).not.toHaveBeenCalled();
    expect(screen.queryByText("Restored")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Restore Bob to the group" }),
    ).toBeVisible();
    // Somebody may have put Bob back first; the refresh shows what is true.
    expect(refresh).toHaveBeenCalled();
  });

  /**
   * Leaving writes the same removal, with the person who left as its actor:
   * the kind of event is a database enum, and a new one would need a
   * migration. The feed tells it apart by that, and the owner can still put
   * them back from it.
   */
  it("says somebody left, rather than that they removed themselves", async () => {
    const BOB_LEFT = event({
      id: "c1",
      action: "participant.removed",
      entityType: "participant",
      entityId: "p-bob",
      actorLabel: "Bob",
      actorParticipantId: "p-bob",
      metadata: { displayName: "Bob" },
    });
    renderWithIntl(
      await ActivityFeed({
        entries: [BOB_LEFT],
        groupId: "g1",
        restorable: new Set(["c1"]),
        timeZone: "UTC",
      }),
      GROUP,
    );

    expect(screen.getByText("Bob")).toBeVisible();
    expect(screen.getByText("left the group")).toBeVisible();
    expect(screen.queryByText(/removed Bob/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Restore Bob to the group" }),
    ).toBeVisible();
  });

  it("still says what it does for a removal that recorded no name", async () => {
    renderWithIntl(
      await ActivityFeed({
        entries: [{ ...BOB_REMOVED, metadata: null }],
        groupId: "g1",
        restorable: new Set(["b1"]),
        timeZone: "UTC",
      }),
      GROUP,
    );

    expect(
      screen.getByRole("button", {
        name: "Restore the person who was removed",
      }),
    ).toBeVisible();
  });
});

/**
 * A person's own link and the group's shared one used to be told apart by
 * nobody: the feed called the first a "guest link", the People screen called
 * both an invite link. The feed now uses the People screen's names — a
 * personal link for somebody, the group link for everybody — and says "you"
 * to the person a link was for.
 */
describe("the lines about links", () => {
  const SEB = { actorLabel: "Seb", actorParticipantId: "p-seb" };
  const ALEX = {
    actorLabel: "Alex",
    actorType: "guest" as const,
    actorParticipantId: "p-alex",
  };

  const SENT = event({
    id: "l1",
    action: "guest_link.created",
    entityType: "guest_invitation",
    ...SEB,
    metadata: {
      participantId: "p-alex",
      participantName: "Alex",
      expiresAt: null,
      replacedPrevious: false,
    },
  });

  const REVOKED = event({
    id: "l2",
    action: "guest_link.revoked",
    entityType: "guest_invitation",
    ...SEB,
    metadata: { participantId: "p-alex", participantName: "Alex" },
  });

  const OPENED = event({
    id: "l3",
    action: "guest_link.redeemed",
    entityType: "guest_invitation",
    ...ALEX,
  });

  /** Joining through the group link mints a personal link behind the scenes. */
  const JOINED = event({
    id: "l4",
    action: "guest_link.created",
    entityType: "guest_invitation",
    ...ALEX,
    metadata: {
      participantName: "Alex",
      expiresAt: null,
      replacedPrevious: false,
      via: "join_link",
      claimed: false,
    },
  });

  async function lines(
    entries: readonly ActivityEntry[],
    viewerId: string | null,
  ) {
    renderWithIntl(
      await ActivityFeed({
        entries,
        groupId: "g1",
        restorable: new Set(),
        timeZone: "UTC",
        people: { you: viewerId, names: new Map() },
      }),
      GROUP,
    );
  }

  it("names whom a personal link was for, and the group link by its own name", async () => {
    await lines([SENT, REVOKED, OPENED, JOINED], "p-seb");

    expect(screen.getByText("sent Alex a personal link")).toBeVisible();
    expect(
      screen.getByText("revoked the personal link for Alex"),
    ).toBeVisible();
    expect(screen.getByText("opened their personal link")).toBeVisible();
    // Nobody sent anybody anything: Alex came in through the group's link.
    expect(screen.getByText("joined with the group link")).toBeVisible();
    expect(screen.queryByText(/guest link|invite link/i)).toBeNull();
  });

  it("says you to the person the link was for", async () => {
    await lines([SENT, REVOKED], "p-alex");

    expect(screen.getByText("sent you a personal link")).toBeVisible();
    expect(screen.getByText("revoked your personal link")).toBeVisible();
    expect(screen.queryByText(/Alex/)).toBeNull();
  });

  it("does not say you twice when the reader opened their own link", async () => {
    await lines([OPENED, JOINED], "p-alex");

    expect(screen.getByText("opened their personal link")).toBeVisible();
    expect(screen.getByText("joined with the group link")).toBeVisible();
  });

  it("still says what happened on a line written before it recorded whom", async () => {
    // Revocations used to record the id alone, and links the name alone.
    const OLD_REVOKED = { ...REVOKED, metadata: { participantId: "p-alex" } };
    const OLD_SENT = { ...SENT, metadata: { participantName: "Alex" } };

    await lines([OLD_REVOKED, OLD_SENT], "p-seb");
    expect(screen.getByText("revoked a personal link")).toBeVisible();
    // The name was always there; only the "you" needs the id.
    expect(screen.getByText("sent Alex a personal link")).toBeVisible();
  });

  it("says you on an old revocation too, which always kept the id", async () => {
    await lines(
      [{ ...REVOKED, metadata: { participantId: "p-alex" } }],
      "p-alex",
    );

    expect(screen.getByText("revoked your personal link")).toBeVisible();
  });
});
