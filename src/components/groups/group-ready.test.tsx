import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { GroupReady } from "./group-ready";

/**
 * The handover screen, straight after "Create group".
 *
 * Its whole job is the link and the sentence that names who it is for, so both
 * are asserted at the copy a person reads — including the two shapes that
 * sentence takes when the list is long, and the one it takes when there is
 * nobody to list yet.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { setJoinLinkExpiryAction } = vi.hoisted(() => ({
  setJoinLinkExpiryAction: vi.fn<
    (
      groupId: string,
      choice: string,
    ) => Promise<{ ok: boolean; data?: { expiresAt: string | null } }>
  >(async () => ({ ok: true, data: { expiresAt: null } })),
}));

vi.mock("@/modules/join/actions", () => ({ setJoinLinkExpiryAction }));

const failure = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...args: unknown[]) => failure(...args) },
}));

const URL = "https://balancia.test/join/g/SECRET-TOKEN";

/**
 * A week out from whatever the clock says now.
 *
 * This screen is only ever reached by tapping "Create group", so it freezes
 * its own "now" from the browser rather than taking one from a server render.
 * A fixed date in the fixture is therefore a countdown that loses a day every
 * day, and this one had already rotted past "In 7 days" into "In 6".
 */
const IN_A_WEEK = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

function renderReady(
  overrides: Partial<React.ComponentProps<typeof GroupReady>> = {},
) {
  const onSkip = vi.fn();
  renderWithIntl(
    <GroupReady
      groupId="g1"
      groupName="Lisbon, March"
      people={["Seb", "Ana", "Tom", "Bea"]}
      invite={{ url: URL, expiresAt: IN_A_WEEK }}
      onSkip={onSkip}
      {...overrides}
    />,
  );
  return { onSkip };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GroupReady", () => {
  it("names the group and hands over its link", () => {
    renderReady();

    expect(
      screen.getByRole("heading", { name: "Your group is ready!" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("balancia.test/join/g/SECRET-TOKEN"),
    ).toBeInTheDocument();
  });

  it("names two people and counts the rest", () => {
    renderReady();

    expect(
      screen.getByText(
        "Share the same link with everyone. Seb, Ana and 2 others can choose their existing name when they open it.",
      ),
    ).toBeInTheDocument();
  });

  it("joins exactly two with an and", () => {
    renderReady({ people: ["Seb", "Ana"] });

    expect(
      screen.getByText(
        "Share the same link with everyone. Seb and Ana can choose their existing name when they open it.",
      ),
    ).toBeInTheDocument();
  });

  it("describes the link instead when there is nobody to name", () => {
    renderReady({ people: ["Seb"] });

    expect(
      screen.getByText(/They can choose their existing name in the group/),
    ).toBeInTheDocument();
  });

  it("copies the link with its scheme intact", async () => {
    const user = userEvent.setup();
    renderReady();

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await navigator.clipboard.readText()).toBe(URL);
  });

  it("says how long the link lasts, and what that means", () => {
    renderReady();

    expect(screen.getByText("In 7 days")).toBeInTheDocument();
    expect(
      screen.getByText(
        /This link is valid for 7 days\. You can change its duration/,
      ),
    ).toBeInTheDocument();
  });

  it("says the other thing when the link never lapses", () => {
    renderReady({ invite: { url: URL, expiresAt: null } });

    expect(screen.getByText("Never")).toBeInTheDocument();
    expect(
      screen.getByText(/stays valid until you revoke it in the group settings/),
    ).toBeInTheDocument();
  });

  /*
   * The three below are why the row reports what it was told to do.
   *
   * The sheet minted this invite and stopped listening, so the prop under
   * this screen never moves. A sentence with a number in it read off that
   * prop would sit under a row that had already changed its mind.
   */
  it("moves the sentence under the row when the expiry does", async () => {
    const user = userEvent.setup();
    renderReady();

    await user.click(screen.getByRole("button", { name: /In 7 days/ }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "In 24 hours" }),
    );

    expect(await screen.findByText("In 24 hours")).toBeInTheDocument();
    expect(
      screen.getByText(/This link is valid for 1 day\./),
    ).toBeInTheDocument();
  });

  it("swaps to the other sentence when the link stops lapsing", async () => {
    const user = userEvent.setup();
    renderReady();

    await user.click(screen.getByRole("button", { name: /In 7 days/ }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Never" }),
    );

    expect(
      await screen.findByText(/stays valid until you revoke it/),
    ).toBeInTheDocument();
  });

  it("puts the sentence back when the change is refused", async () => {
    const user = userEvent.setup();
    setJoinLinkExpiryAction.mockResolvedValueOnce({ ok: false });
    renderReady();

    await user.click(screen.getByRole("button", { name: /In 7 days/ }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "In 24 hours" }),
    );

    expect(failure).toHaveBeenCalled();
    expect(
      await screen.findByText(/This link is valid for 7 days/),
    ).toBeInTheDocument();
  });

  it("explains what happens to the names that were typed in", () => {
    renderReady();

    expect(screen.getByText("No duplicates")).toBeInTheDocument();
  });

  it("lets the organiser leave without sharing anything", async () => {
    const user = userEvent.setup();
    const { onSkip } = renderReady();

    await user.click(screen.getByRole("button", { name: "Later" }));

    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("falls back to copying where there is no share sheet", async () => {
    const user = userEvent.setup();
    renderReady();

    // jsdom has no `navigator.share`, which is exactly the case the fallback
    // is for: the primary action becomes Copy rather than a dead Share.
    const primary = await screen.findByRole("button", {
      name: "Copy the link",
    });
    await user.click(primary);

    expect(screen.queryByRole("button", { name: "Share the link" })).toBeNull();
    expect(await navigator.clipboard.readText()).toBe(URL);
  });
});
