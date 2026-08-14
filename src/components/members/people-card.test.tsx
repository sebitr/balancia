import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
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
} = vi.hoisted(() => ({
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
  updateParticipantAction: vi.fn(async () => ({ ok: true })),
}));

function person(overrides: Partial<PersonView> = {}): PersonView {
  return {
    id: "p1",
    name: "Cyril",
    email: "",
    isOwner: false,
    access: "none",
    joinedAt: "2026-07-02T10:00:00.000Z",
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

function render(people: PersonView[]) {
  return renderWithIntl(
    <PeopleCard groupId="g1" people={people} canManage canInvite />,
  );
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
    ]);

    expect(screen.getByText("Owner")).toBeVisible();
    expect(screen.getByText("No access")).toBeVisible();
    expect(screen.getByText("Link live")).toBeVisible();
    expect(screen.getByText(/No account · not invited yet/)).toBeVisible();
    expect(
      screen.getByText(/Invite link created .* · not opened yet/),
    ).toBeVisible();
  });

  it("opens one row at a time", async () => {
    const user = userEvent.setup();
    render([OWNER, person()]);

    const rows = screen.getAllByRole("button", { expanded: false });
    await user.click(rows[0]);
    expect(screen.getByRole("button", { expanded: true })).toBeVisible();
    expect(screen.getByText(/Seb signs in with seb@trosset.net/)).toBeVisible();

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

  it("never offers to remove the owner", async () => {
    const user = userEvent.setup();
    render([OWNER]);

    await user.click(screen.getByRole("button", { name: /Seb/ }));
    expect(
      screen.queryByRole("button", { name: /Remove from group/ }),
    ).not.toBeInTheDocument();
  });
});
