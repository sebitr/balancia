import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { PeopleCard, type PersonView } from "./people-card";

/**
 * The People card, at the level a person uses it: one row open at a time, a
 * link that is only ever shown once, and a removal that says why it cannot
 * happen yet.
 *
 * The server is the boundary — every action is mocked, and what is asserted is
 * what the screen does with the answer.
 */

const refresh = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => refresh(),
    replace: (href: string) => replace(href),
  }),
}));

/*
 * Hoisted with the `vi.mock` factory that hands them out, which runs before the
 * module body. The signatures are declared rather than implemented, so
 * `mock.calls` is typed without naming arguments none of these ignore.
 */
type ById = (
  groupId: string,
  participantId: string,
) => Promise<{ ok: boolean }>;

const {
  createInvitationAction,
  leaveGroupAction,
  removeParticipantAction,
  restoreParticipantAction,
  updateParticipantAction,
} = vi.hoisted(() => ({
  leaveGroupAction: vi.fn<
    (groupId: string) => Promise<{ ok: boolean; error?: string }>
  >(async () => ({ ok: true })),
  updateParticipantAction: vi.fn<
    (
      groupId: string,
      participantId: string,
      formData: FormData,
    ) => Promise<{ ok: boolean; error?: string }>
  >(async () => ({ ok: true })),
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
  removeParticipantAction: vi.fn<ById>(async () => ({ ok: true })),
  restoreParticipantAction: vi.fn<ById>(async () => ({ ok: true })),
}));

/*
 * The toaster itself lives in the root layout, so in jsdom there is nothing to
 * render into. What matters here is the offer the screen makes — a success
 * message carrying an Undo — so the call is captured and its action invoked.
 */
const success = vi.fn();
const error = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    error: (...args: unknown[]) => error(...args),
  },
}));

vi.mock("@/modules/groups/actions", () => ({
  addParticipantAction: vi.fn(async () => ({
    ok: true,
    data: { participantId: "new" },
  })),
  createInvitationAction,
  leaveGroupAction,
  removeParticipantAction,
  restoreParticipantAction,
  revokeInvitationAction: vi.fn(async () => ({ ok: true })),
  updateParticipantAction,
}));

function person(overrides: Partial<PersonView> = {}): PersonView {
  return {
    id: "p1",
    name: "Cyril",
    email: "",
    isOwner: false,
    access: "none",
    link: null,
    balances: [],
    ...overrides,
  };
}

const OWNER = person({
  id: "seb",
  name: "Seb",
  email: "seb@trosset.net",
  isOwner: true,
  access: "account",
});

/** The owner's view, which is the only one that sees every control. */
function render(
  people: PersonView[],
  props: Partial<React.ComponentProps<typeof PeopleCard>> = {},
) {
  return renderWithIntl(
    <PeopleCard
      groupId="g1"
      groupName="Flat"
      archived={false}
      people={people}
      viewerId="seb"
      canManage
      canInvite
      canRemove
      canLeave={false}
      {...props}
    />,
  );
}

/** What a member — someone who joined a group they do not own — is offered. */
function renderAsMember(
  people: PersonView[],
  viewerId: string | null = "member",
  props: Partial<React.ComponentProps<typeof PeopleCard>> = {},
) {
  return render(people, {
    viewerId,
    canInvite: false,
    canRemove: false,
    canLeave: true,
    ...props,
  });
}

/** What one write posted, as plain entries. */
function written(call = 0) {
  const formData = updateParticipantAction.mock.calls[call]?.[2];
  return (key: string) => formData?.get(key);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PeopleCard", () => {
  it("labels each access state on the collapsed row", () => {
    render([
      OWNER,
      person(),
      person({
        id: "herve",
        name: "hervé",
        access: "link",
        link: {
          createdAt: "2026-08-12T09:00:00.000Z",
          expiresAt: null,
          lastUsedAt: null,
        },
      }),
      person({
        id: "padi",
        name: "Padi",
        access: "link",
        link: {
          createdAt: "2026-08-12T09:00:00.000Z",
          expiresAt: null,
          lastUsedAt: "2026-08-17T09:00:00.000Z",
        },
      }),
    ]);

    expect(screen.getByText("Owner")).toBeVisible();
    expect(screen.getByText("seb@trosset.net")).toBeVisible();
    expect(screen.getByText("No access")).toBeVisible();
    expect(screen.getAllByText("Guest")).toHaveLength(2);
    expect(screen.getByText(/No account · not invited yet/)).toBeVisible();
    expect(screen.getByText(/No account · link not used yet/)).toBeVisible();
    expect(screen.getByText(/No account · joined/)).toBeVisible();
  });

  it("opens one row at a time", async () => {
    const user = userEvent.setup();
    render([OWNER, person()]);

    const rows = screen.getAllByRole("button", { expanded: false });
    await user.click(rows[0]);
    expect(screen.getByRole("button", { expanded: true })).toBeVisible();
    expect(
      screen.getByText(
        /Seb signs in with seb@trosset.net.*they always have full access/,
      ),
    ).toBeVisible();

    // By name: the owner's open row now ends in a dialog trigger, which is a
    // collapsed button too.
    await user.click(screen.getByRole("button", { name: /Cyril/ }));
    // Still exactly one — opening the second closed the first.
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
    expect(
      screen.queryByText(/Seb signs in with seb@trosset.net/),
    ).not.toBeInTheDocument();
  });

  it("shows a created link once, and drops it when another row opens", async () => {
    const user = userEvent.setup();
    render([OWNER, person()]);

    await user.click(screen.getByRole("button", { name: /Cyril/ }));
    await user.click(
      screen.getByRole("button", { name: "Create invite link" }),
    );

    expect(screen.getByText("Copy this link now")).toBeVisible();
    expect(
      screen.getByText("https://balancia.test/join/SECRET-TOKEN"),
    ).toBeVisible();

    // Reading someone else's row is not a reason to leave a live token on
    // screen behind you.
    await user.click(screen.getByRole("button", { name: /Seb/ }));
    expect(
      screen.queryByText("https://balancia.test/join/SECRET-TOKEN"),
    ).not.toBeInTheDocument();
  });

  it("sends the chosen expiry with the link request", async () => {
    const user = userEvent.setup();
    render([person()]);

    await user.click(screen.getByRole("button", { name: /Cyril/ }));
    expect(
      screen.getByText(
        "Cyril has no account. With a one-time link, they can take part without signing up.",
      ),
    ).toBeVisible();
    await user.selectOptions(
      screen.getByLabelText("Expires"),
      screen.getByRole("option", { name: "In 24 hours" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Create invite link" }),
    );

    expect(createInvitationAction.mock.calls[0][1].get("expiresInDays")).toBe(
      "1",
    );
  });

  it("blocks removal while someone still owes, and says how much", async () => {
    const user = userEvent.setup();
    render([person({ balances: [{ minorUnits: "-1170", currency: "EUR" }] })]);

    await user.click(screen.getByRole("button", { name: /Cyril/ }));

    expect(
      screen.getByRole("button", { name: /Remove from group/ }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Cyril still owes €11\.70\. Settle up first/),
    ).toBeVisible();
  });

  it("removes only after the sheet confirms it, and offers an undo", async () => {
    const user = userEvent.setup();
    render([person()]);

    await user.click(screen.getByRole("button", { name: /Cyril/ }));
    await user.click(screen.getByRole("button", { name: /Remove from group/ }));

    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("Remove Cyril?")).toBeVisible();
    // The toast is the fast way back, not the only one.
    expect(
      within(sheet).getByText(
        /undo this right after, or restore them later from Activity\./,
      ),
    ).toBeVisible();
    expect(removeParticipantAction).not.toHaveBeenCalled();

    await user.click(within(sheet).getByRole("button", { name: "Remove" }));
    expect(removeParticipantAction).toHaveBeenCalledWith("g1", "p1");

    const [message, options] = success.mock.calls.at(-1) as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("Cyril removed from the group");
    expect(options.action.label).toBe("Undo");

    options.action.onClick();
    expect(restoreParticipantAction).toHaveBeenCalledWith("g1", "p1");
  });

  it("writes a rename once the typing stops, and offers the name back", async () => {
    const user = userEvent.setup();
    render([person()]);

    await user.click(screen.getByRole("button", { name: /Cyril/ }));
    await user.type(screen.getByLabelText("Name"), "le");

    // Two keystrokes and nothing sent yet: the pause is what sends it.
    expect(updateParticipantAction).not.toHaveBeenCalled();

    await waitFor(
      () => expect(updateParticipantAction).toHaveBeenCalledOnce(),
      {
        timeout: 3000,
      },
    );
    expect(written()("displayName")).toBe("Cyrille");

    const [message, options] = success.mock.calls.at(-1) as [
      string,
      { id?: string; action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("Changes saved");
    // Named for the person: renaming a second one leaves the first way back.
    expect(options.id).toBe("person-p1");

    await act(async () => options.action.onClick());

    await waitFor(() =>
      expect(updateParticipantAction).toHaveBeenCalledTimes(2),
    );
    expect(written(1)("displayName")).toBe("Cyril");
    expect(screen.getByLabelText("Name")).toHaveValue("Cyril");
  });

  it("sends a rename typed a moment before the row is closed", async () => {
    const user = userEvent.setup();
    render([person()]);

    const row = screen.getByRole("button", { name: /Cyril/ });
    await user.click(row);
    await user.type(screen.getByLabelText("Name"), "le");
    // Closing the row unmounts the panel, and the pause never arrives.
    await user.click(row);

    await waitFor(() => expect(updateParticipantAction).toHaveBeenCalledOnce());
    expect(written()("displayName")).toBe("Cyrille");
  });

  it("holds the write while an address is half typed, and says so", async () => {
    const user = userEvent.setup();
    render([person()]);

    await user.click(screen.getByRole("button", { name: /Cyril/ }));
    await user.type(screen.getByLabelText(/Email/), "cyril@");
    // Leaving the field would normally be enough to send it.
    await user.tab();

    expect(
      screen.getByText("That is not an email address yet."),
    ).toBeInTheDocument();
    expect(updateParticipantAction).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Email/), "example.com");
    await user.tab();

    await waitFor(() => expect(updateParticipantAction).toHaveBeenCalledOnce());
    expect(written()("email")).toBe("cyril@example.com");
    expect(
      screen.queryByText("That is not an email address yet."),
    ).not.toBeInTheDocument();
  });

  it("says a name is missing rather than writing an empty one", async () => {
    const user = userEvent.setup();
    render([person()]);

    await user.click(screen.getByRole("button", { name: /Cyril/ }));
    await user.clear(screen.getByLabelText("Name"));
    await user.tab();

    expect(screen.getByText("This person needs a name.")).toBeInTheDocument();
    expect(updateParticipantAction).not.toHaveBeenCalled();
  });

  it("never offers to remove the owner", async () => {
    const user = userEvent.setup();
    render([OWNER]);

    await user.click(screen.getByRole("button", { name: /Seb/ }));
    expect(
      screen.queryByRole("button", { name: /Remove from group/ }),
    ).not.toBeInTheDocument();
  });

  it("does not offer the owner someone else's name or email to edit", async () => {
    const user = userEvent.setup();
    const member = person({
      id: "member",
      name: "Amélie",
      email: "amelie@example.com",
      access: "account",
    });
    render([OWNER, member]);

    // Their access and their place in the group are the owner's to change.
    await user.click(screen.getByRole("button", { name: /Amélie/ }));
    expect(screen.getByText("Access")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Remove from group/ }),
    ).toBeVisible();
    // The name they go by and the address they sign in with are not.
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    // The label carries an "optional" qualifier, hence the loose match.
    expect(screen.queryByLabelText(/Email/)).not.toBeInTheDocument();
  });

  it("lets an account holder rename themselves, but not restate their email", async () => {
    const user = userEvent.setup();
    const me = person({
      id: "member",
      name: "Amélie",
      email: "amelie@example.com",
      access: "account",
    });
    renderAsMember([OWNER, me]);

    await user.click(screen.getByRole("button", { name: /Amélie/ }));
    expect(screen.getByLabelText("Your name in this group")).toHaveValue(
      "Amélie",
    );
    expect(
      screen.queryByText(/email address changes in your account settings/),
    ).not.toBeInTheDocument();
    // The label carries an "optional" qualifier, hence the loose match.
    expect(screen.queryByLabelText(/Email/)).not.toBeInTheDocument();
  });

  it("keeps access and removal off a non-owner's screen", async () => {
    const user = userEvent.setup();
    renderAsMember([OWNER, person()]);

    // Someone without an account is still theirs to name...
    await user.click(screen.getByRole("button", { name: /Cyril/ }));
    expect(screen.getByLabelText("Name")).toBeVisible();
    expect(screen.getByLabelText(/Email/)).toBeVisible();
    // ...but the invite link and the door are the owner's.
    expect(screen.queryByText("Access")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create invite link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Remove from group/ }),
    ).not.toBeInTheDocument();
  });

  it("leaves a row unopenable when there is nothing behind it", () => {
    // A guest: no account of their own, and nobody else's row to manage.
    render([OWNER, person()], {
      viewerId: "guest",
      canManage: false,
      canInvite: false,
      canRemove: false,
    });

    expect(screen.queryAllByRole("button", { expanded: false })).toHaveLength(
      0,
    );
    expect(screen.getByText("Seb")).toBeVisible();
    expect(screen.getByText("Cyril")).toBeVisible();
  });
});

/**
 * The reader's own way out, at the foot of their own row: held back for the
 * reasons removal is, in their own words, and confirmed in a dialog that
 * opens on staying and promises no undo it could not keep.
 */
describe("leaving the group", () => {
  const ME = person({
    id: "member",
    name: "Amélie",
    email: "amelie@example.com",
    access: "account",
  });

  async function openMine(
    me: PersonView = ME,
    props: Partial<React.ComponentProps<typeof PeopleCard>> = {},
  ) {
    const user = userEvent.setup();
    renderAsMember([OWNER, me, person()], "member", props);
    await user.click(screen.getByRole("button", { name: /Amélie/ }));
    return user;
  }

  it("is offered on the reader's own row, and on nobody else's", async () => {
    const user = await openMine();

    const leave = screen.getByRole("button", { name: "Leave this group" });
    expect(leave).toBeEnabled();
    expect(leave).toHaveAccessibleDescription(
      "You will stop seeing this group. What you added stays in it, under your name.",
    );

    // Somebody else's row, open, offers no way to take them out.
    await user.click(screen.getByRole("button", { name: /Cyril/ }));
    expect(
      screen.queryByRole("button", { name: "Leave this group" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Remove from group/ }),
    ).not.toBeInTheDocument();
  });

  it("waits until the reader has paid what they owe, and says how much", async () => {
    await openMine({
      ...ME,
      balances: [{ minorUnits: "-3000", currency: "EUR" }],
    });

    const leave = screen.getByRole("button", { name: "Leave this group" });
    expect(leave).toBeDisabled();
    expect(leave).toHaveAccessibleDescription(
      "You still owe €30.00. Settle up first, then leave.",
    );
  });

  it("waits until the reader has been paid back, too", async () => {
    await openMine({
      ...ME,
      balances: [{ minorUnits: "3000", currency: "EUR" }],
    });

    expect(
      screen.getByRole("button", { name: "Leave this group" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "You are still owed €30.00. Settle up first, then leave.",
      ),
    ).toBeVisible();
  });

  it("names every currency still open, whichever way each runs", async () => {
    await openMine({
      ...ME,
      balances: [
        { minorUnits: "-3000", currency: "EUR" },
        { minorUnits: "2000", currency: "CHF" },
      ],
    });

    expect(
      screen.getByText(
        /^You still have €30\.00, CHF.?20\.00 outstanding\. Settle up first, then leave\.$/,
      ),
    ).toBeVisible();
  });

  it("tells the owner why they cannot, and what they can do instead", async () => {
    const user = userEvent.setup();
    render([OWNER, person()]);

    await user.click(screen.getByRole("button", { name: /Seb/ }));

    const leave = screen.getByRole("button", { name: "Leave this group" });
    expect(leave).toBeDisabled();
    expect(leave).toHaveAccessibleDescription(
      "You own this group, so you cannot leave it. To stop using it, archive it or delete it in the group's settings.",
    );
  });

  it("is held shut in an archived group, which only its owner can reopen", async () => {
    await openMine(ME, { archived: true });

    expect(
      screen.getByRole("button", { name: "Leave this group" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "This group is archived. Its owner has to restore it before you can leave.",
      ),
    ).toBeVisible();
  });

  it("is not offered to a guest, whose way out is the owner's", () => {
    const guest = person({
      id: "guest",
      name: "Hervé",
      access: "link",
      link: {
        createdAt: "2026-08-12T09:00:00.000Z",
        expiresAt: null,
        lastUsedAt: "2026-08-17T09:00:00.000Z",
      },
    });
    render([OWNER, guest], {
      viewerId: "guest",
      canManage: false,
      canInvite: false,
      canRemove: false,
      canLeave: false,
    });

    // Nothing behind their own row at all, so it is not a control.
    expect(screen.queryAllByRole("button", { expanded: false })).toHaveLength(
      0,
    );
    expect(
      screen.queryByRole("button", { name: "Leave this group" }),
    ).not.toBeInTheDocument();
  });

  it("asks first, opening on the safe choice, and promises no undo", async () => {
    const user = await openMine();
    await user.click(screen.getByRole("button", { name: "Leave this group" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Leave Flat?")).toBeVisible();
    expect(
      within(dialog).getByText(
        "You will no longer see this group. Everything you added stays under your name. To come back, someone in the group has to invite you again.",
      ),
    ).toBeVisible();
    expect(within(dialog).queryByText(/undo/i)).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Stay in the group" }),
    ).toHaveFocus();

    await user.click(
      within(dialog).getByRole("button", { name: "Stay in the group" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(leaveGroupAction).not.toHaveBeenCalled();
  });

  it("leaves, says so, and goes home with no way back to offer", async () => {
    const user = await openMine();
    await user.click(screen.getByRole("button", { name: "Leave this group" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Leave group",
      }),
    );

    // The group only: whose row it is, the server knows without being told.
    expect(leaveGroupAction).toHaveBeenCalledWith("g1");
    expect(success).toHaveBeenCalledWith("You left Flat");
    // No Undo: the reader could not open the group it would put them back in.
    expect(success.mock.calls.at(-1)).toHaveLength(1);
    expect(replace).toHaveBeenCalledWith("/dashboard");
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("stays put and says why when the server refuses", async () => {
    leaveGroupAction.mockResolvedValueOnce({
      ok: false,
      error:
        "You still have money outstanding in this group. Settle up first, then leave.",
    });
    const user = await openMine();
    await user.click(screen.getByRole("button", { name: "Leave this group" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Leave group",
      }),
    );

    expect(error).toHaveBeenCalledWith(
      "You still have money outstanding in this group. Settle up first, then leave.",
    );
    expect(success).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    // What changed since the screen was drawn is fetched, so the row can say.
    expect(refresh).toHaveBeenCalled();
  });
});
