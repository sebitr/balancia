import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { RemindRecipient } from "@/modules/reminders/types";
import { PeopleCard, type PersonView } from "./people-card";
import type { PeopleLedger } from "./people-ledger";

/**
 * The People card at width: the same people, drawn as a table from `lg` up,
 * with the phone's open row behind a menu at the end of each.
 *
 * `matchMedia` is the switch, as it is for the transactions table: the shared
 * setup answers false to every query, which is a phone, and
 * `people-card.test.tsx` drives that renderer as it always has; here it
 * answers true to `lg`, so the table is the one mounted.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { createInvitationAction, removeParticipantAction } = vi.hoisted(() => ({
  createInvitationAction: vi.fn<
    (
      groupId: string,
      formData: FormData,
    ) => Promise<{
      ok: boolean;
      data: { url: string; expiresAt: string | null };
    }>
  >(async () => ({
    ok: true,
    data: { url: "https://balancia.test/join/SECRET-TOKEN", expiresAt: null },
  })),
  removeParticipantAction: vi.fn<
    (groupId: string, participantId: string) => Promise<{ ok: boolean }>
  >(async () => ({ ok: true })),
}));

vi.mock("@/modules/groups/actions", () => ({
  addParticipantAction: vi.fn(async () => ({
    ok: true,
    data: { participantId: "new" },
  })),
  createInvitationAction,
  leaveGroupAction: vi.fn(async () => ({ ok: true })),
  removeParticipantAction,
  restoreParticipantAction: vi.fn(async () => ({ ok: true })),
  revokeInvitationAction: vi.fn(async () => ({ ok: true })),
  updateParticipantAction: vi.fn(async () => ({ ok: true })),
}));

let matchMedia: typeof window.matchMedia;

/** A window from `lg` up: the one query the card listens to answers yes. */
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
  createInvitationAction.mockClear();
  removeParticipantAction.mockClear();
});

afterEach(() => {
  window.matchMedia = matchMedia;
});

/*
 * Lisbon, March, read by Seb, who owns it: Ravi owes him in euros and is owed
 * in francs, Tomás has never had an account, Jonas owes and was reminded this
 * morning, and Amélie is square.
 */
const SEB: PersonView = {
  id: "seb",
  name: "Seb",
  email: "seb@home.lan",
  isOwner: true,
  access: "account",
  link: null,
  balances: [
    { minorUnits: "24800", currency: "EUR" },
    { minorUnits: "-6220", currency: "CHF" },
  ],
};
const AMELIE: PersonView = {
  id: "amelie",
  name: "Amélie",
  email: "amelie@home.lan",
  isOwner: false,
  access: "account",
  link: null,
  balances: [],
};
const JONAS: PersonView = {
  ...AMELIE,
  id: "jonas",
  name: "Jonas",
  email: "jonas@home.lan",
  balances: [{ minorUnits: "-14860", currency: "EUR" }],
};
const RAVI: PersonView = {
  ...AMELIE,
  id: "ravi",
  name: "Ravi",
  email: "ravi@home.lan",
  balances: [
    { minorUnits: "-9940", currency: "EUR" },
    { minorUnits: "6220", currency: "CHF" },
  ],
};
const TOMAS: PersonView = {
  id: "tomas",
  name: "Tomás",
  email: "",
  isOwner: false,
  access: "none",
  link: null,
  balances: [],
};

const PEOPLE = [SEB, AMELIE, JONAS, RAVI, TOMAS];

const LEDGER: PeopleLedger = {
  currency: "EUR",
  others: ["CHF"],
  figures: {
    seb: { paid: "58660", share: "33860" },
    amelie: { paid: "46660", share: "25000" },
    ravi: { paid: "7640", share: "17580" },
    jonas: { paid: "0", share: "26860" },
  },
};

function recipient(overrides: Partial<RemindRecipient>): RemindRecipient {
  return {
    participantId: "ravi",
    name: "Ravi",
    debts: [{ amount: "9940", currency: "EUR" }],
    channel: "share",
    payWith: [],
    lastRemindedAt: null,
    locked: false,
    muted: false,
    link: { kind: "group" },
    ...overrides,
  };
}

const RECIPIENTS = [
  recipient({}),
  recipient({
    participantId: "jonas",
    name: "Jonas",
    debts: [{ amount: "14860", currency: "EUR" }],
    lastRemindedAt: "2026-08-12T08:00:00Z",
    locked: true,
  }),
];

function render(props: Partial<React.ComponentProps<typeof PeopleCard>> = {}) {
  return renderWithIntl(
    <PeopleCard
      groupId="g1"
      groupName="Lisbon, March"
      archived={false}
      people={PEOPLE}
      viewerId="seb"
      canManage
      canInvite
      canRemove
      canLeave={false}
      ledger={LEDGER}
      recipients={RECIPIENTS}
      senderName="Seb"
      {...props}
    />,
  );
}

/** The table row a person's name sits in. */
function rowOf(name: string): HTMLElement {
  const row = screen.getByRole("link", { name }).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("PeopleCard at width", () => {
  it("draws the table instead of the phone's rows", () => {
    const { container } = render();

    expect(screen.getByRole("table", { name: "People" })).toBeInTheDocument();
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["Person", "Role", "Paid", "Share", "Position", "Actions"]);
    // The accordion's rows — a whole row as the toggle — are not mounted
    // beside it, so no panel can be open twice.
    expect(
      container.querySelector('div[role="button"][aria-expanded]'),
    ).toBeNull();
  });

  it("opens a person's page from their name, which covers the row", () => {
    render();

    expect(screen.getByRole("link", { name: "Ravi" })).toHaveAttribute(
      "href",
      "/groups/g1/members/ravi",
    );
  });

  it("gives each person their role, what they paid and their share", () => {
    render();

    const seb = rowOf("Seb");
    expect(within(seb).getByText("Owner")).toBeInTheDocument();
    expect(within(seb).getByText("you")).toBeInTheDocument();
    expect(seb).toHaveTextContent("€586.60");
    expect(seb).toHaveTextContent("€338.60");

    const ravi = rowOf("Ravi");
    expect(within(ravi).getByText("Member")).toBeInTheDocument();
    expect(within(ravi).getByText("ravi@home.lan")).toBeInTheDocument();
    expect(ravi).toHaveTextContent("€76.40");
    expect(ravi).toHaveTextContent("€175.80");

    // Somebody who has spent nothing in the table's currency reads zero.
    const tomas = rowOf("Tomás");
    expect(within(tomas).getByText("Guest")).toBeInTheDocument();
    expect(
      within(tomas).getByText("No account · link not sent yet"),
    ).toBeInTheDocument();
    expect(within(tomas).getAllByText("€0.00")).toHaveLength(2);
  });

  it("says where each person stands in words, one line per currency", () => {
    render();

    const seb = within(rowOf("Seb"));
    expect(seb.getByText(/you get back/)).toHaveTextContent(
      "€248.00 you get back",
    );
    expect(seb.getByText(/you owe/)).toHaveTextContent(/^CHF.?62\.20 you owe$/);
    expect(seb.getByText(/you get back/)).toHaveClass("text-positive-ink");
    expect(seb.getByText(/you owe/)).toHaveClass("text-negative-ink");

    const ravi = within(rowOf("Ravi"));
    expect(ravi.getByText(/owes$/)).toHaveTextContent("€99.40 owes");
    expect(ravi.getByText(/gets back$/)).toHaveTextContent(
      /^CHF.?62\.20 gets back$/,
    );

    expect(within(rowOf("Amélie")).getByText("Settled up")).toHaveClass(
      "text-neutral-balance-ink",
    );
  });

  it("offers Remind to whoever owes the reader, and says when they were", () => {
    render();

    expect(
      within(rowOf("Ravi")).getByRole("button", { name: "Remind Ravi" }),
    ).toBeEnabled();
    expect(
      within(rowOf("Jonas")).getByRole("button", { name: "Reminded" }),
    ).toBeDisabled();
    expect(
      within(rowOf("Amélie")).queryByRole("button", { name: /Remind/ }),
    ).not.toBeInTheDocument();
  });

  it("counts the people and names the currencies the columns leave out", () => {
    render();

    expect(
      screen.getByText("5 people · 1 person has no account yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Paid and share in EUR · CHF on each person’s page"),
    ).toBeInTheDocument();
  });

  it("drops Paid and Share for a group that has spent nothing", () => {
    render({ ledger: null });

    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["Person", "Role", "Position", "Actions"]);
    expect(screen.queryByText(/Paid and share in/)).not.toBeInTheDocument();
  });

  it("opens the phone's panel from a row's menu, and reveals a new link there", async () => {
    const user = userEvent.setup();
    render();

    await user.click(screen.getByRole("button", { name: "Options for Tomás" }));
    const menu = await screen.findByRole("dialog", {
      name: "Options for Tomás",
    });

    // The phone's own words and controls, not a second copy of them.
    await user.click(
      within(menu).getByRole("button", { name: "Personal link for Tomás" }),
    );
    await user.click(
      within(menu).getByRole("button", { name: "Create the link" }),
    );

    await waitFor(() => expect(createInvitationAction).toHaveBeenCalled());
    expect(createInvitationAction.mock.calls[0]?.[1].get("participantId")).toBe(
      "tomas",
    );
    expect(
      await within(menu).findByText("https://balancia.test/join/SECRET-TOKEN"),
    ).toBeInTheDocument();
  });

  it("closes the menu for the removal's confirmation, and removes on yes", async () => {
    const user = userEvent.setup();
    render();

    await user.click(screen.getByRole("button", { name: "Options for Tomás" }));
    const menu = await screen.findByRole("dialog", {
      name: "Options for Tomás",
    });
    await user.click(
      within(menu).getByRole("button", { name: "Remove from group" }),
    );

    const confirm = await screen.findByRole("dialog", {
      name: "Remove Tomás?",
    });
    expect(
      screen.queryByRole("dialog", { name: "Options for Tomás" }),
    ).not.toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(removeParticipantAction).toHaveBeenCalledWith("g1", "tomas"),
    );
  });

  it("gives a row no menu when its panel would be empty", () => {
    // A member reading somebody else with an account: their name and address
    // are their own, and access belongs to the owner.
    render({
      viewerId: "amelie",
      canInvite: false,
      canRemove: false,
      canLeave: true,
      recipients: [],
    });

    expect(
      screen.queryByRole("button", { name: "Options for Ravi" }),
    ).not.toBeInTheDocument();
    // Their own row still holds the way out.
    expect(
      screen.getByRole("button", { name: "Options for Amélie" }),
    ).toBeInTheDocument();
  });
});
