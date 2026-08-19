import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { InviteLinkCard } from "./invite-link-card";

/**
 * The invite link card in group settings.
 *
 * The interesting behaviour is which of the four states the card is in, and
 * what each one offers: a live link can be shared and moved, a dead one can
 * only be replaced, and revoking asks first. Every mutation is mocked — the
 * server is the boundary, and what is asserted is what the card does with the
 * answer.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
}));

const { createJoinLinkAction, revokeJoinLinkAction, setJoinLinkExpiryAction } =
  vi.hoisted(() => ({
    createJoinLinkAction: vi.fn<
      (groupId: string, formData: FormData) => Promise<{ ok: boolean }>
    >(async () => ({ ok: true })),
    revokeJoinLinkAction: vi.fn<(groupId: string) => Promise<{ ok: boolean }>>(
      async () => ({ ok: true }),
    ),
    setJoinLinkExpiryAction: vi.fn<
      (
        groupId: string,
        choice: string,
      ) => Promise<{ ok: boolean; data?: { expiresAt: string | null } }>
    >(async () => ({ ok: true, data: { expiresAt: null } })),
  }));

vi.mock("@/modules/join/actions", () => ({
  createJoinLinkAction,
  revokeJoinLinkAction,
  setJoinLinkExpiryAction,
}));

const success = vi.fn();
const failure = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    error: (...args: unknown[]) => failure(...args),
  },
}));

const NOW = "2026-08-19T12:00:00.000Z";
const URL = "https://balancia.test/join/g/SECRET-TOKEN";

function renderCard(
  overrides: Partial<React.ComponentProps<typeof InviteLinkCard>> = {},
) {
  return renderWithIntl(
    <InviteLinkCard
      groupId="g1"
      groupName="Lisbon, March"
      link={{
        status: "active",
        url: URL,
        expiresAt: "2026-08-26T12:00:00.000Z",
      }}
      unclaimedCount={3}
      now={NOW}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a live link", () => {
  it("shows the link, what it is, and when it stops", () => {
    renderCard();

    expect(screen.getByText("Active")).toBeInTheDocument();
    // Shown without the scheme, which is noise nobody reads out loud.
    expect(
      screen.getByText("balancia.test/join/g/SECRET-TOKEN"),
    ).toBeInTheDocument();
    expect(screen.getByText("In 7 days")).toBeInTheDocument();
  });

  it("copies the whole URL, scheme and all", async () => {
    // `userEvent.setup()` installs a working clipboard in jsdom, so what is
    // read back here is what a person would paste.
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await navigator.clipboard.readText()).toBe(URL);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("moves the expiry without minting anything", async () => {
    const user = userEvent.setup();
    setJoinLinkExpiryAction.mockResolvedValueOnce({
      ok: true,
      data: { expiresAt: null },
    });
    renderCard();

    await user.click(screen.getByRole("button", { name: /In 7 days/ }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Never" }),
    );

    expect(setJoinLinkExpiryAction).toHaveBeenCalledWith("g1", "never");
    expect(createJoinLinkAction).not.toHaveBeenCalled();
    expect(await screen.findByText("Never")).toBeInTheDocument();
  });

  it("puts the old date back when the change is refused", async () => {
    const user = userEvent.setup();
    setJoinLinkExpiryAction.mockResolvedValueOnce({ ok: false });
    renderCard();

    await user.click(screen.getByRole("button", { name: /In 7 days/ }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "In 24 hours" }),
    );

    expect(failure).toHaveBeenCalled();
    expect(await screen.findByText("In 7 days")).toBeInTheDocument();
  });

  it("asks before revoking, and only then revokes", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Revoke link" }));
    expect(revokeJoinLinkAction).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Revoke link" }),
    );

    expect(revokeJoinLinkAction).toHaveBeenCalledWith("g1");
    expect(success).toHaveBeenCalled();
  });

  it("points at the people who have yet to walk through it", () => {
    renderCard();

    expect(
      screen.getByText("3 people have no account yet"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute(
      "href",
      "/groups/g1/members",
    );
  });

  it("says nothing about accounts once everybody has one", () => {
    renderCard({ unclaimedCount: 0 });

    expect(screen.queryByRole("link", { name: "People" })).toBeNull();
  });
});

describe("a link that is over", () => {
  it("still shows a revoked link, with one way forward", async () => {
    const user = userEvent.setup();
    renderCard({
      link: { status: "revoked", url: URL, expiresAt: null },
    });

    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke link" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Create a new link" }));
    expect(createJoinLinkAction).toHaveBeenCalled();
  });

  it("says an expired link is expired rather than revoked", () => {
    renderCard({
      link: {
        status: "expired",
        url: URL,
        expiresAt: "2026-08-12T12:00:00.000Z",
      },
    });

    expect(screen.getByText("Expired")).toBeInTheDocument();
  });
});

describe("a link that cannot be shown", () => {
  it("explains itself and offers a replacement", () => {
    renderCard({ link: { status: "active", url: null, expiresAt: null } });

    expect(screen.getByText(/can no longer be shown here/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create a new link" }),
    ).toBeInTheDocument();
    // Still live, so turning it off is still on offer.
    expect(
      screen.getByRole("button", { name: "Revoke link" }),
    ).toBeInTheDocument();
  });

  it("offers to make the first one when a group has never had a link", () => {
    renderCard({ link: null });

    expect(
      screen.getByText("This group has no invite link yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Active")).toBeNull();
  });
});
