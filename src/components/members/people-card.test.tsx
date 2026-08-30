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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
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
  removeParticipantAction,
  restoreParticipantAction,
  updateParticipantAction,
} = vi.hoisted(() => ({
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
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    error: vi.fn(),
  },
}));

vi.mock("@/modules/groups/actions", () => ({
  addParticipantAction: vi.fn(async () => ({
    ok: true,
    data: { participantId: "new" },
  })),
  createInvitationAction,
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
      people={people}
      viewerId="seb"
      canManage
      canInvite
      canRemove
      {...props}
    />,
  );
}

/** What a member — someone who joined a group they do not own — is offered. */
function renderAsMember(
  people: PersonView[],
  viewerId: string | null = "member",
) {
  return render(people, { viewerId, canInvite: false, canRemove: false });
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
        /Seb signs in with seb@trosset.net.*\(s\)he always has full access/,
      ),
    ).toBeVisible();

    await user.click(screen.getAllByRole("button", { expanded: false })[0]);
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
        "Cyril has no account. With a one-time link, (s)he can take part without signing up.",
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
