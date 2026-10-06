import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { OnboardingFlow } from "./onboarding-flow";
import type { OnboardingGroupView } from "./types";

/**
 * The three welcomes, and what each of them refuses to offer.
 *
 * The prototype's two bugs were both here: a condition tested in one place and
 * forgotten in another painted one arrival's chrome around another's buttons.
 * `route.test.ts` covers the order of the screens; this covers what is on
 * them, which is the half a route table cannot state.
 */

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

/**
 * The Server Actions these screens call.
 *
 * Mocked rather than reached: they are `"use server"` modules that open a
 * database, and what is under test here is which screen runs them and what the
 * flow does with the answer.
 */
const joinWithAccountAction = vi.hoisted(() => vi.fn());
const joinAsGuestAction = vi.hoisted(() => vi.fn());

vi.mock("@/modules/join/actions", () => ({
  joinWithAccountAction,
  joinAsGuestAction,
}));

// The funnel counter is a beacon, sent and forgotten; what is checked here is
// that the flow names its screens, not that a registry counted them.
const recordOnboardingStep = vi.hoisted(() => vi.fn());

vi.mock("./funnel", () => ({ recordOnboardingStep }));

/**
 * The screens a journey crossed, in order, ending in `left` when it handed
 * over to a group or the dashboard. The same counts the operator's funnel
 * gets, which is what makes them the honest measure of how long a route is.
 */
const stepsTaken = () =>
  recordOnboardingStep.mock.calls.map(([, step]) => step as string);

// The "you're in" a shared link ends on is a toast over the group, so it is
// the toast that is checked rather than a screen.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: Object.assign(vi.fn(), toast),
}));

const startGroupAsGuestAction = vi.hoisted(() => vi.fn());

vi.mock("@/modules/groups/actions", () => ({ startGroupAsGuestAction }));
vi.mock("@/components/groups/use-detected-timezone", () => ({
  useDetectedTimezone: () => "Europe/Zurich",
}));

const auth = vi.hoisted(() => ({
  registerAction: vi.fn(),
  requestSignInCodeAction: vi.fn(),
  signInWithCodeAction: vi.fn(),
  startCodeSignupAction: vi.fn(),
  verifySignupCodeAction: vi.fn(),
}));

vi.mock("@/modules/auth/actions", () => auth);

const profileActions = vi.hoisted(() => ({
  setDisplayNameAction: vi.fn(),
  setFavoriteCurrenciesAction: vi.fn(),
  setPreferredCurrencyAction: vi.fn(),
}));

vi.mock("@/modules/profile/actions", () => profileActions);

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  router.refresh.mockClear();
  joinWithAccountAction.mockReset();
  joinWithAccountAction.mockResolvedValue({
    ok: true,
    data: { groupId: "group-1" },
  });
  joinAsGuestAction.mockReset();
  joinAsGuestAction.mockResolvedValue({
    ok: true,
    data: { groupId: "group-1" },
  });
  recordOnboardingStep.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
  passkeyDevice.platform = true;
  startGroupAsGuestAction.mockReset();
  startGroupAsGuestAction.mockResolvedValue({
    ok: true,
    data: {
      groupId: "group-new",
      invite: { url: "https://balancia.test/join/g/abc", expiresAt: null },
    },
  });
  for (const action of Object.values(auth)) action.mockReset();
  auth.startCodeSignupAction.mockResolvedValue({ ok: true });
  auth.verifySignupCodeAction.mockResolvedValue({
    ok: true,
    data: { joinedGroupId: null, claimedGroupId: "group-1" },
  });
  auth.registerAction.mockResolvedValue({
    ok: true,
    data: { verificationRequired: false, claimedGroupId: null },
  });
  for (const action of Object.values(profileActions)) action.mockReset();
  profileActions.setDisplayNameAction.mockResolvedValue({ ok: true });
});

// WebAuthn does not exist in jsdom, and the hooks that ask are facts about the
// environment rather than state — so they are stubbed rather than waited for.
// `platform` is the one a test may vary: whether this device can hold a
// passkey of its own, which decides which button comes first.
const passkeyDevice = vi.hoisted(() => ({ platform: true as boolean | null }));

vi.mock("@/components/auth/use-passkey-support", () => ({
  usePasskeySupport: () => true,
  usePlatformAuthenticator: () => passkeyDevice.platform,
}));

// The browser's own ceremonies, which jsdom cannot run: what is checked is
// that the checklist's passkey row runs one and then reads as done.
const passkeyClient = vi.hoisted(() => ({
  registerPasskey: vi.fn(async () => {}),
  signInWithPasskey: vi.fn(async () => {}),
}));

vi.mock("@/modules/auth/passkey-client", () => passkeyClient);

const group: OnboardingGroupView = {
  groupId: "group-1",
  summary: {
    groupName: "Weekend in Verbier",
    participantCount: 5,
    expenseCount: 23,
    since: "12 Mar",
    totals: [{ currency: "CHF", minorUnits: "128000" }],
    faces: ["Léa Martin", "Tom Iten", "Anna Frei"],
  },
  position: { currency: "CHF", minorUnits: "8420" },
  settleRequest: null,
};

const members = [
  {
    id: "member-1",
    displayName: "Marc T.",
    expenseCount: 6,
    balances: [{ currency: "CHF", minorUnits: "4200" }],
  },
  {
    id: "member-2",
    displayName: "Alex",
    expenseCount: 2,
    balances: [{ currency: "EUR", minorUnits: "-6000" }],
  },
];

describe("the personal invitation", () => {
  it("names who added them, and offers all three ways in", () => {
    renderWithIntl(
      <OnboardingFlow arrival="personal" group={group} inviterName="Léa" />,
    );

    expect(
      screen.getByRole("heading", {
        name: /Léa added you to Weekend in Verbier/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create an account" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    // Two lines inside one control, which jsdom and screen readers both run
    // together — hence the stated accessible name.
    expect(
      screen.getByRole("button", { name: /Continue as a guest — Just a name/ }),
    ).toBeInTheDocument();
  });

  it("shows the group it is inviting somebody to", () => {
    renderWithIntl(<OnboardingFlow arrival="personal" group={group} />);
    expect(screen.getByText("Weekend in Verbier")).toBeInTheDocument();
    expect(screen.getByText(/5 people · 23 expenses/)).toBeInTheDocument();
  });

  it("hides account creation on an instance that has closed it", () => {
    renderWithIntl(
      <OnboardingFlow
        arrival="personal"
        group={group}
        registrationAllowed={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Create an account" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("asks a guest for a name and nothing else", async () => {
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFlow arrival="personal" group={group} />);

    await user.click(
      screen.getByRole("button", { name: /Continue as a guest/ }),
    );

    expect(
      screen.getByRole("heading", { name: "What should the group call you?" }),
    ).toBeInTheDocument();
    // No address is asked for, and the guarantee is stated rather than implied.
    expect(screen.queryByPlaceholderText("you@example.com")).toBeNull();
    expect(
      screen.getByText(/Guest access lives in this browser/),
    ).toBeInTheDocument();
    // The name screen commits nothing, so the welcome is still a tap away.
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("lands a guest in the group, as a shared link's guest lands, in two screens", async () => {
    // It used to end on "You're in as a guest", whose "See the group" opened
    // a checklist of four rows a guest could keep only one of.
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow
        arrival="personal"
        group={group}
        inviterName="Léa"
        knownName="Grace"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Continue as a guest/ }),
    );
    expect(screen.getByRole("textbox", { name: "Your name" })).toHaveValue(
      "Grace",
    );
    await user.click(screen.getByRole("button", { name: "Join as a guest" }));

    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
    expect(toast.success).toHaveBeenCalledWith("You're in Weekend in Verbier", {
      description: undefined,
    });
    expect(screen.queryByText("Finish setting up")).toBeNull();
    expect(stepsTaken()).toEqual(["welcome", "profile", "left"]);
  });

  it("keeps the checklist for an account, behind a button that says so", async () => {
    auth.verifySignupCodeAction.mockResolvedValue({
      ok: true,
      data: { joinedGroupId: null, claimedGroupId: "group-1" },
    });
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="personal" group={group} knownName="Grace" />,
    );

    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "grace@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Email me a code instead" }),
    );
    await user.type(screen.getByLabelText("The six-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "You're in, Grace" }),
    ).toBeInTheDocument();
    // The balance is the reader's, and said to them.
    expect(screen.getByText(/You get back CHF\s84\.20/)).toBeInTheDocument();
    // Two buttons, each saying what it does. Nothing anywhere says "See the
    // group" and opens something else.
    expect(screen.queryByRole("button", { name: "See the group" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Go to the group" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Finish setting up" }));
    expect(screen.getByText("Account created")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Go to the group" }));
    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
  });

  it("goes straight to the group from the arrival screen when asked to", async () => {
    auth.verifySignupCodeAction.mockResolvedValue({
      ok: true,
      data: { joinedGroupId: null, claimedGroupId: "group-1" },
    });
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="personal" group={group} knownName="Grace" />,
    );

    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "grace@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Email me a code instead" }),
    );
    await user.type(screen.getByLabelText("The six-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Go to the group" }));

    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
    expect(stepsTaken()).toEqual([
      "welcome",
      "identity",
      "profile",
      "arrival",
      "left",
    ]);
  });
});

/**
 * The group's shared link, signed out.
 *
 * Two screens and then the group: the list, and how to come in. The welcome
 * that used to say the link could not know who opened it is a sentence on the
 * list now, "Is this you?" is the next screen's name and balance with a way
 * back, and the arrival screen and the checklist that stood between the join
 * and the group are a toast over the group and its guest card. Each journey
 * below counts its screens, so one creeping back in fails here by number.
 */
describe("the shared link", () => {
  it("opens on the list, under the group, as an invitation from somebody", () => {
    renderWithIntl(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        inviterName="Léa"
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Léa invited you to Weekend in Verbier. Which of these is you?",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/5 people · 23 expenses/)).toBeInTheDocument();
    // The one useful sentence the old welcome had.
    expect(screen.getByText(/it can't tell who opened it/)).toBeInTheDocument();
    // The account question waits until there is somebody to keep.
    expect(
      screen.queryByRole("button", { name: "Create an account" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Continue as a guest/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(recordOnboardingStep).toHaveBeenCalledWith("shared", "whichOne");
  });

  it("is still an invitation when the link has nobody's name on it", () => {
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );
    expect(
      screen.getByRole("heading", {
        name: "You're invited to Weekend in Verbier. Which of these is you?",
      }),
    ).toBeInTheDocument();
  });

  it("says what each name owes or gets back, with the word beside the amount", () => {
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    expect(
      screen.getByRole("button", {
        name: /^Marc T\. — gets back CHF\s42\.00 · 6 expenses$/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Alex — owes €60.00 · 2 expenses" }),
    ).toBeInTheDocument();
    // The word and the figure are one phrase, in the balance's own tone.
    const owes = screen.getByText("owes €60.00");
    expect(owes).toHaveClass("text-negative-ink");
    expect(screen.queryByText(/filed/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /None of these/ }),
    ).toBeInTheDocument();
  });

  it("walks a guest who picks a name into the group in two screens", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(screen.getByRole("button", { name: /^Alex/ }));

    // The name, and the balance said to them as theirs.
    expect(
      screen.getByRole("heading", {
        name: "Alex, how do you want to join Weekend in Verbier?",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("You owe €60.00")).toBeInTheDocument();
    expect(screen.queryByText(/Their position/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Not you? Back to the list" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Continue as a guest — Stays in this browser\. Nothing you add is lost if you create an account later\./,
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Continue as a guest/ }),
    );

    expect(joinAsGuestAction).toHaveBeenCalledWith({
      participantId: "member-2",
      displayName: "Alex",
    });
    // Straight to the group, which says "you're in" itself.
    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
    expect(toast.success).toHaveBeenCalledWith("You're in Weekend in Verbier", {
      description:
        "2 expenses were already under your name. They're yours now.",
    });
    expect(stepsTaken()).toEqual(["whichOne", "keepIt", "left"]);
  });

  it("walks a guest who is new into the group in two screens, under the name they type", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(screen.getByRole("button", { name: /None of these/ }));

    expect(
      screen.getByRole("heading", {
        name: "What should Weekend in Verbier call you?",
      }),
    ).toBeInTheDocument();
    // Every way in files them under the name, so none of them goes first.
    expect(
      screen.getByRole("button", { name: /Continue as a guest/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Create an account" }),
    ).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "Your name" }), "Dana");
    await user.click(
      screen.getByRole("button", { name: /Continue as a guest/ }),
    );

    expect(joinAsGuestAction).toHaveBeenCalledWith({
      participantId: null,
      displayName: "Dana",
    });
    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
    expect(toast.success).toHaveBeenCalledWith("You're in Weekend in Verbier", {
      description: undefined,
    });
    expect(stepsTaken()).toEqual(["whichOne", "keepIt", "left"]);
  });

  it("goes back to the list from the next screen, having un-chosen the name", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(screen.getByRole("button", { name: /^Alex/ }));
    await user.click(
      screen.getByRole("button", { name: "Not you? Back to the list" }),
    );

    expect(
      screen.getByRole("button", { name: /^Alex — owes/ }),
    ).toBeInTheDocument();
    // Not "I'm Alex, and I'm new here": they have just said they are not.
    expect(
      screen.getByRole("button", { name: "None of these — I'm new here" }),
    ).toBeInTheDocument();
    expect(joinAsGuestAction).not.toHaveBeenCalled();
  });

  it("keeps a refused guest join on the screen it was chosen from", async () => {
    joinAsGuestAction.mockResolvedValue({
      ok: false,
      error: "Somebody else claimed that name first.",
    });
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(screen.getByRole("button", { name: /^Alex/ }));
    await user.click(
      screen.getByRole("button", { name: /Continue as a guest/ }),
    );

    expect(
      screen.getByText("Somebody else claimed that name first."),
    ).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("signs an existing account in and lands it in the group in three screens", async () => {
    auth.requestSignInCodeAction.mockResolvedValue({ ok: true });
    auth.signInWithCodeAction.mockResolvedValue({
      ok: true,
      data: { joinedGroupId: "group-1", claimedGroupId: null },
    });
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(screen.getByRole("button", { name: /^Alex/ }));
    await user.click(
      screen.getByRole("button", { name: "I already have an account" }),
    );
    expect(
      screen.getByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "alex@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Email me a code instead" }),
    );
    await user.type(screen.getByLabelText("The six-digit code"), "123456");

    // The listed name rides on the sign-in; the group comes from the cookie.
    expect(auth.signInWithCodeAction).toHaveBeenCalledWith({
      email: "alex@example.com",
      code: "123456",
      join: { participantId: "member-2", displayName: "Alex" },
    });
    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
    expect(stepsTaken()).toEqual(["whichOne", "keepIt", "identity", "left"]);
  });

  it("joins after a passkey sign-in, which cannot carry the join itself", async () => {
    // A discoverable passkey names the account through a route that has
    // never heard of the link, so it comes back with no group. Before, the
    // flow said "You're in" and left for the dashboard, outside the group.
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(screen.getByRole("button", { name: /^Alex/ }));
    await user.click(
      screen.getByRole("button", { name: "I already have an account" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Sign in with a passkey/ }),
    );

    expect(passkeyClient.signInWithPasskey).toHaveBeenCalledTimes(1);
    expect(joinWithAccountAction).toHaveBeenCalledWith({
      participantId: "member-2",
      displayName: "Alex",
    });
    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
  });

  it("joins after a password signup, and keeps the reader on the link to do it", async () => {
    // The password used to be a link to /register/password, which knew
    // nothing of the group: the account was made and the join was lost.
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        codeSignupAvailable={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^Alex/ }));
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.click(
      screen.getByRole("button", { name: "Sign up with a password" }),
    );
    // The name is the one picked from the list; nothing asks for it again.
    expect(screen.queryByRole("textbox", { name: "Your name" })).toBeNull();
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "alex@example.com",
    );
    await user.type(screen.getByLabelText("Password"), "analytical engine");
    await user.click(screen.getByRole("button", { name: "Create my account" }));

    expect(auth.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Alex", email: "alex@example.com" }),
    );
    expect(joinWithAccountAction).toHaveBeenCalledWith({
      participantId: "member-2",
      displayName: "Alex",
    });
    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
    expect(stepsTaken()).toEqual(["whichOne", "keepIt", "identity", "left"]);
  });

  it("creates an account and lands it in the group in three screens", async () => {
    auth.verifySignupCodeAction.mockResolvedValue({
      ok: true,
      data: { joinedGroupId: "group-1", claimedGroupId: null },
    });
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(screen.getByRole("button", { name: /^Alex/ }));
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "alex@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Email me a code instead" }),
    );
    await user.type(screen.getByLabelText("The six-digit code"), "123456");

    expect(auth.verifySignupCodeAction).toHaveBeenCalledWith({
      email: "alex@example.com",
      code: "123456",
      join: { participantId: "member-2", displayName: "Alex" },
    });
    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
    expect(screen.queryByText("Finish setting up")).toBeNull();
    expect(stepsTaken()).toEqual(["whichOne", "keepIt", "identity", "left"]);
  });

  it("says so, rather than pretending, when the name went while they signed up", async () => {
    auth.verifySignupCodeAction.mockResolvedValue({
      ok: true,
      data: { joinedGroupId: null, claimedGroupId: null },
    });
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(screen.getByRole("button", { name: /^Alex/ }));
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "alex@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Email me a code instead" }),
    );
    await user.type(screen.getByLabelText("The six-digit code"), "123456");

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "You're signed in, but you could not be added to Weekend in Verbier. Open the link again to pick your name.",
    );
    expect(router.push).toHaveBeenCalledWith("/dashboard");
  });

  it("says so when the link no longer resolves", () => {
    renderWithIntl(<OnboardingFlow arrival="shared" group={null} linkGone />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /None of these/ })).toBeNull();
  });
});

describe("the cold arrival", () => {
  it("describes the product, because there is no group to describe", () => {
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);
    expect(
      screen.getByRole("heading", { name: "Keep track of who owes what" }),
    ).toBeInTheDocument();
  });

  it("offers a group of their own instead of a guest seat, having no group to be a guest of", () => {
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);
    expect(
      screen.getByRole("button", { name: "Create an account" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Continue as a guest/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Start a group without an account/ }),
    ).toBeInTheDocument();
  });

  it("withholds the no-account group where registration is closed", () => {
    renderWithIntl(
      <OnboardingFlow
        arrival="cold"
        group={null}
        registrationAllowed={false}
      />,
    );
    expect(
      screen.queryByRole("button", {
        name: /Start a group without an account/,
      }),
    ).toBeNull();
  });

  it("starts a group with no account, hands over its link, and lands in it", async () => {
    // Kittysplit, Splid and Tricount all let a person in with a name and a
    // group; this is Balancia's version, built on the guest session an
    // invitation would have minted.
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);

    await user.click(
      screen.getByRole("button", { name: /Start a group without an account/ }),
    );
    expect(screen.getByText("Your group")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Group name"), "Lisbon trip");
    await user.type(screen.getByLabelText("Your name"), "Dana");
    await user.click(screen.getByRole("button", { name: "Create the group" }));

    expect(startGroupAsGuestAction).toHaveBeenCalledWith(
      expect.objectContaining({
        groupName: "Lisbon trip",
        displayName: "Dana",
        timezone: "Europe/Zurich",
        // A guest states no preference, so the device's place decides: a
        // phone in Zurich keeps its group in francs rather than in euros.
        baseCurrency: "CHF",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Your group is ready!" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/balancia\.test\/join\/g\/abc/),
    ).toBeInTheDocument();
    // A guest shares the link; moving its expiry is the owner's, later.
    expect(screen.queryByText("Link expiration")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(router.push).toHaveBeenCalledWith("/groups/group-new");
  });

  /**
   * The currency is the one answer about a group that never changes, and this
   * screen used to decide it out of sight: the guess was right for a phone at
   * home and wrong for one on holiday, and nobody could tell which.
   */
  it("shows the currency the group will be in, and lets it be changed", async () => {
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);

    await user.click(
      screen.getByRole("button", { name: /Start a group without an account/ }),
    );

    // Guessed from where the device is, and said before anything is created.
    const field = screen.getByRole("button", { name: /Currency: CHF/ });
    expect(field).toBeVisible();
    expect(screen.getByText("Group currency")).toBeVisible();
    expect(screen.getByText(/Fixed once the group exists/)).toBeInTheDocument();

    // Narrowed first: a role query over all 156 rows is slow enough in jsdom
    // to time out on a busy machine, and searching is how people use it.
    await user.click(field);
    await user.type(
      await screen.findByRole("textbox", { name: "Search a currency" }),
      "EUR",
    );
    await user.click(await screen.findByRole("button", { name: /^EUR/ }));

    expect(
      await screen.findByRole("button", { name: /Currency: EUR/ }),
    ).toBeVisible();

    await user.type(screen.getByLabelText("Group name"), "Lisbon trip");
    await user.type(screen.getByLabelText("Your name"), "Dana");
    await user.click(screen.getByRole("button", { name: "Create the group" }));

    expect(startGroupAsGuestAction).toHaveBeenCalledWith(
      expect.objectContaining({ baseCurrency: "EUR" }),
    );
  });

  it("keeps a refused group start on its own screen, with the reason", async () => {
    startGroupAsGuestAction.mockResolvedValue({
      ok: false,
      error: "Registration is closed on this instance.",
    });
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);

    await user.click(
      screen.getByRole("button", { name: /Start a group without an account/ }),
    );
    await user.type(screen.getByLabelText("Group name"), "Lisbon trip");
    await user.type(screen.getByLabelText("Your name"), "Dana");
    await user.click(screen.getByRole("button", { name: "Create the group" }));

    expect(
      screen.getByText("Registration is closed on this instance."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Your group is ready!" }),
    ).toBeNull();
  });

  it("leads with a passkey and keeps the code as the fallback", async () => {
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);

    await user.click(screen.getByRole("button", { name: "Create an account" }));

    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Continue with a passkey/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Email me a code instead" }),
    ).toBeInTheDocument();
  });

  it("counts every screen it reaches, and the exit, for the operator's funnel", async () => {
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);
    expect(recordOnboardingStep).toHaveBeenCalledWith("cold", "welcome");

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(recordOnboardingStep).toHaveBeenLastCalledWith("cold", "identity");

    auth.requestSignInCodeAction.mockResolvedValue({ ok: true });
    auth.signInWithCodeAction.mockResolvedValue({
      ok: true,
      data: { joinedGroupId: null, claimedGroupId: null },
    });
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "ada@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Email me a code instead" }),
    );
    await user.type(screen.getByLabelText("The six-digit code"), "123456");

    expect(recordOnboardingStep).toHaveBeenLastCalledWith("cold", "left");
  });

  it("opens the create sheet from the first-group screen, not an empty list", async () => {
    // "You're in. No groups yet. Create your first group" used to land on a
    // dashboard saying "Nothing here yet. Create a group": two screens, two
    // identical buttons, before the one field that matters.
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);

    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "ada@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Email me a code instead" }),
    );
    await user.type(screen.getByLabelText("The six-digit code"), "123456");
    await user.type(screen.getByRole("textbox", { name: "Your name" }), "Ada");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(
      screen.getByRole("button", { name: "Create your first group" }),
    );

    expect(router.push).toHaveBeenCalledWith("/dashboard?new");
  });

  it("makes a second code wait, so the first cannot be retired in the post", async () => {
    // Issuing a code invalidates the one before it. A resend tapped while the
    // first mail is still arriving is how a correct code stops working, so
    // the button counts down and says so.
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);

    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "ada@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Email me a code instead" }),
    );

    const resend = screen.getByRole("button", { name: /Send another code/ });
    expect(resend).toBeDisabled();
    expect(resend).toHaveTextContent(/in \d+ s$/);
    expect(auth.startCodeSignupAction).toHaveBeenCalledTimes(1);
  });

  it("sends a returning account to its groups without asking its name", async () => {
    // This is the journey that renamed people. Signing in through the welcome
    // screen ran the profile screen next, with an empty name field and a
    // disabled Continue, and then a "No groups yet" for an account that had
    // several. The route ends on the credential now, and the dashboard is the
    // welcome.
    auth.requestSignInCodeAction.mockResolvedValue({ ok: true });
    auth.signInWithCodeAction.mockResolvedValue({
      ok: true,
      data: { joinedGroupId: null, claimedGroupId: null },
    });
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      screen.getByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
    // The welcome is still one tap away: nothing has been committed yet.
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "ada@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Email me a code instead" }),
    );
    await user.type(screen.getByLabelText("The six-digit code"), "123456");

    expect(auth.signInWithCodeAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: /Last thing/ })).toBeNull();
    expect(screen.queryByText("No groups yet")).toBeNull();
    expect(router.push).toHaveBeenCalledWith("/dashboard");
    expect(profileActions.setDisplayNameAction).not.toHaveBeenCalled();
  });

  it("says what a passkey is, in the words people recognise", async () => {
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);
    await user.click(screen.getByRole("button", { name: "Create an account" }));

    expect(
      screen.getByText(
        "Your face, fingerprint or screen lock. Nothing to remember.",
      ),
    ).toBeInTheDocument();
  });

  it("puts the code first on a device that cannot hold a passkey", async () => {
    // A desktop with a WebAuthn API and nothing behind it: the passkey button
    // there opens a sheet asking for a phone or a security key, so it waits
    // underneath the code rather than leading with a dead end.
    passkeyDevice.platform = false;
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);
    await user.click(screen.getByRole("button", { name: "Create an account" }));

    const buttons = screen
      .getAllByRole("button")
      .map((button) => button.textContent?.trim())
      .filter((label) => label && /passkey|code/i.test(label));
    expect(buttons).toEqual(["Email me a code", "Continue with a passkey"]);
  });

  it("keeps the passkey first while the device is still answering", async () => {
    passkeyDevice.platform = null;
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);
    await user.click(screen.getByRole("button", { name: "Create an account" }));

    const buttons = screen
      .getAllByRole("button")
      .map((button) => button.textContent?.trim())
      .filter((label) => label && /passkey|code/i.test(label));
    expect(buttons).toEqual([
      "Continue with a passkey",
      "Email me a code instead",
    ]);
  });

  it("keeps the password a tap away where there is no mail server, on the same step", async () => {
    // Before, the password link appeared only when neither a passkey nor a
    // code could be offered — so a mail-less instance read on a phone showed
    // exactly one button, and somebody who did not want a passkey had no
    // visible way to say so. Then it was a link to /register/password, a page
    // of its own with a confirm field, which left the flow altogether.
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow
        arrival="cold"
        group={null}
        codeSignupAvailable={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Create an account" }));

    expect(
      screen.queryByRole("link", { name: "Sign up with a password" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Sign up with a password" }),
    );

    // Still the Account step: the same bar, the same label, the same way back.
    expect(
      screen.getByRole("heading", { name: "Your email, and a password" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Account" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    // One password, and the eye instead of a second one.
    expect(screen.queryByLabelText(/Confirm/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show password", pressed: false }),
    ).toBeInTheDocument();

    // And the passkey is one tap back.
    await user.click(
      screen.getByRole("button", { name: "Use a passkey instead" }),
    );
    expect(
      screen.getByRole("button", { name: /Continue with a passkey/ }),
    ).toBeInTheDocument();
  });

  it("creates the account with a password and carries on to the name and the first group", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow
        arrival="cold"
        group={null}
        codeSignupAvailable={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.click(
      screen.getByRole("button", { name: "Sign up with a password" }),
    );

    // A cold arrival has no name yet, and the account cannot exist without
    // one, so this step asks for it.
    await user.type(
      screen.getByRole("textbox", { name: "Your name" }),
      "Ada Lovelace",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "ada@example.com",
    );
    await user.type(screen.getByLabelText("Password"), "analytical engine");
    await user.click(screen.getByRole("button", { name: "Create my account" }));

    expect(auth.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ada Lovelace",
        email: "ada@example.com",
        password: "analytical engine",
      }),
    );
    // The next step of the same flow, holding the name just typed.
    expect(
      screen.getByRole("heading", { name: /Last thing/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Your name" })).toHaveValue(
      "Ada Lovelace",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("button", { name: "Create your first group" }),
    ).toBeInTheDocument();
    expect(stepsTaken()).toEqual([
      "welcome",
      "identity",
      "profile",
      "firstGroup",
    ]);
  });

  it("refuses a password everybody uses under the field, before anything is sent", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow
        arrival="cold"
        group={null}
        codeSignupAvailable={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.click(
      screen.getByRole("button", { name: "Sign up with a password" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Your name" }),
      "Ada Lovelace",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "ada@example.com",
    );
    const password = screen.getByLabelText("Password");
    await user.type(password, "password123");
    await user.click(screen.getByRole("button", { name: "Create my account" }));

    expect(auth.registerAction).not.toHaveBeenCalled();
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveFocus();
    expect(password).toHaveAccessibleDescription(
      /That password is one of the most commonly used ones/,
    );
  });

  it("offers no code on an instance with no mail server", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow
        arrival="cold"
        group={null}
        codeSignupAvailable={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create an account" }));

    expect(
      screen.getByRole("button", { name: /Continue with a passkey/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Email me a code/ }),
    ).toBeNull();
  });
});

/**
 * The reader who was already signed in when the link arrived.
 *
 * This is the case that used to do nothing at all: `/join/g/[token]` sent them
 * to the dashboard, which says nothing about the group they were invited to,
 * so the link looked broken. They get the shared link's screens — the whole
 * point being that the *identity* question is the only one left, since they
 * walked in holding the account the flow would have asked them to make.
 */
describe("the shared link, opened by somebody already signed in", () => {
  const account = { name: "Léa Martin", email: "lea@example.com" };

  const asLea = (
    <OnboardingFlow
      arrival="shared"
      group={group}
      members={members}
      account={account}
    />
  );

  it("runs the flow rather than sending them to the dashboard", () => {
    renderWithIntl(asLea);

    expect(router.replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /^Marc T\./ }),
    ).toBeInTheDocument();
  });

  it("says which account it is about to join as, before anybody picks", () => {
    renderWithIntl(asLea);

    // A link opened on a borrowed laptop is the case where somebody takes a
    // balance as the wrong person, so the account is named on the list.
    expect(
      screen.getByText(/You're signed in as Léa Martin/),
    ).toBeInTheDocument();
  });

  it("joins as that account when they say which name is theirs, in two screens", async () => {
    const user = userEvent.setup();
    renderWithIntl(asLea);

    await user.click(screen.getByRole("button", { name: /^Marc T\./ }));

    expect(
      screen.getByRole("heading", {
        name: "Marc T., ready to join Weekend in Verbier?",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You get back CHF\s42\.00/)).toBeInTheDocument();
    // Nothing to keep and nothing to prove: one button, and it is the join.
    expect(
      screen.queryByRole("button", { name: "Create an account" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Continue as a guest/ }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Join Weekend in Verbier" }),
    );

    // The participant is named; the group is not. It comes from the cookie on
    // the server, which is what stops a request naming any group it likes.
    expect(joinWithAccountAction).toHaveBeenCalledWith({
      participantId: "member-1",
      displayName: "Marc T.",
    });
    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
    expect(screen.queryByPlaceholderText("you@example.com")).toBeNull();
    expect(stepsTaken()).toEqual(["whichOne", "keepIt", "left"]);
  });

  it("files a new member under the typed name for somebody not on the list", async () => {
    const user = userEvent.setup();
    renderWithIntl(asLea);

    await user.click(screen.getByRole("button", { name: /None of these/ }));

    // Prefilled from the account, because that is the likeliest answer — and
    // it is the participant's name being asked for, not the account's.
    const field = screen.getByRole("textbox", { name: "Your name" });
    expect(field).toHaveValue("Léa Martin");
    await user.clear(field);
    await user.type(field, "Léa M.");
    await user.click(
      screen.getByRole("button", { name: "Join Weekend in Verbier" }),
    );

    expect(joinWithAccountAction).toHaveBeenCalledWith({
      participantId: null,
      displayName: "Léa M.",
    });
    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
  });

  it("offers the account's own name to somebody who was not on the list", () => {
    renderWithIntl(asLea);
    expect(
      screen.getByRole("button", { name: /I'm Léa Martin, and I'm new here/ }),
    ).toBeInTheDocument();
  });

  it("keeps them on the screen they refused, with the reason", async () => {
    joinWithAccountAction.mockResolvedValue({
      ok: false,
      error: "Somebody else claimed that name first.",
    });
    const user = userEvent.setup();
    renderWithIntl(asLea);

    await user.click(screen.getByRole("button", { name: /^Marc T\./ }));
    await user.click(
      screen.getByRole("button", { name: "Join Weekend in Verbier" }),
    );

    expect(
      screen.getByText("Somebody else claimed that name first."),
    ).toBeInTheDocument();
    // Still standing on it, so the list is one tap away.
    expect(
      screen.getByRole("button", { name: "Not you? Back to the list" }),
    ).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});

/**
 * The other two arrivals, which still turn a signed-in reader away.
 *
 * A personal invitation is addressed to one person and has already spent its
 * token into a guest session; there is nothing on those screens for somebody
 * holding an account. Only the shared link is the exception.
 */
describe("a signed-in reader on a personal invitation", () => {
  it("leaves for the dashboard rather than running the flow", () => {
    renderWithIntl(
      <OnboardingFlow
        arrival="personal"
        group={null}
        account={{ name: "Léa Martin", email: "lea@example.com" }}
      />,
    );

    expect(router.replace).toHaveBeenCalledWith("/dashboard");
  });
});

/**
 * The checklist, and the account that has already done all of it.
 *
 * It is a receipt of what is set up, so it has to read what already was: the
 * screen used to assume every answer was "no", which showed somebody their own
 * photo, their own payout method and their own currencies as four things still
 * to do. Where nothing at all is outstanding the screen does not appear.
 *
 * Only a personal invitation reaches it now, and the account it reads arrives
 * halfway along: the invitation page can load a profile only once somebody has
 * signed in from inside the flow, so each case signs in and then hands it down.
 */
describe("what the checklist already knows", () => {
  const everything = {
    hasPhoto: true,
    hasPasskey: true,
    currencies: ["CHF", "EUR"],
    payouts: [{ method: "bank", detail: "CH93 0076 2011 6238 5295 7" }],
    pushEnabled: true,
  };

  /** Signs in from the invitation, then renders what the page renders next. */
  const signIn = async (
    user: ReturnType<typeof userEvent.setup>,
    rerender: (ui: React.ReactElement) => void,
    profile: typeof everything,
  ) => {
    auth.requestSignInCodeAction.mockResolvedValue({ ok: true });
    auth.signInWithCodeAction.mockResolvedValue({
      ok: true,
      data: { joinedGroupId: null, claimedGroupId: "group-1" },
    });
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "lea@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Email me a code instead" }),
    );
    await user.type(screen.getByLabelText("The six-digit code"), "123456");
    rerender(
      <OnboardingFlow
        arrival="personal"
        group={null}
        account={{ name: "Léa Martin", email: "lea@example.com" }}
        profile={profile}
      />,
    );
  };

  it("never shows the screen to somebody who has all of it", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(
      <OnboardingFlow arrival="personal" group={group} />,
    );

    await signIn(user, rerender, everything);

    // Nothing left, so nothing offered: the one button is the way out.
    expect(
      screen.queryByRole("button", { name: "Finish setting up" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Go to the group" }));

    expect(screen.queryByText("Finish setting up")).toBeNull();
    // Straight to the group, which is what the arrival screen's button says.
    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
  });

  it("still shows it when one thing is outstanding", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(
      <OnboardingFlow arrival="personal" group={group} />,
    );

    await signIn(user, rerender, { ...everything, hasPhoto: false });
    await user.click(screen.getByRole("button", { name: "Finish setting up" }));

    expect(screen.getByText("Finish setting up")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("counts what was set up before as done, not as still to do", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(
      <OnboardingFlow arrival="personal" group={group} />,
    );

    await signIn(user, rerender, { ...everything, hasPhoto: false });
    await user.click(screen.getByRole("button", { name: "Finish setting up" }));

    // Account, currencies, payouts and push: four of the five, from the
    // profile alone. Only the photo is left.
    expect(screen.getByText("4 of 5")).toBeInTheDocument();
    expect(screen.getByText("CHF · EUR")).toBeInTheDocument();
    expect(screen.getByText("Bank transfer")).toBeInTheDocument();
    expect(screen.getByText(/pushed to this device/)).toBeInTheDocument();
    expect(screen.getByText(/initials for now/)).toBeInTheDocument();
  });
});

describe("a guest who came to /register to stop being one", () => {
  /*
   * The page underneath this flow answers a different question halfway
   * through.
   *
   * `/register` reads the actor to decide what kind of arrival this is: a
   * guest gets the personal arrival, with the group they are a guest of behind
   * it, and everybody else gets the cold one. Claiming the account is what
   * turns the first into the second — and the profile screen's rename is a
   * Server Action, so the page re-renders with the new answer while the reader
   * is still standing on the flow.
   *
   * The arrival is therefore captured when the flow mounts, the same way the
   * account and the group are. It was not, and the last two screens of this
   * journey fell out of the route from under somebody halfway along it: the
   * arrival screen's button left for the group itself, and the checklist — the
   * one screen that says the account now exists — was never shown at all.
   */
  const asAGuest = (
    <OnboardingFlow
      arrival="personal"
      group={group}
      knownName="Grace"
      alreadyGuest
    />
  );

  /** What the page renders from the moment the claim lands. */
  const onceClaimed = (
    <OnboardingFlow
      arrival="cold"
      group={null}
      account={{ name: "Grace", email: "grace@example.com" }}
    />
  );

  const createTheAccount = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "grace@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Email me a code instead" }),
    );
    // The sixth digit submits, so there is no button to press after this.
    await user.type(screen.getByLabelText("The six-digit code"), "123456");
    // The name the group already knows them by is in the field already.
    await user.click(screen.getByRole("button", { name: "Continue" }));
  };

  it("reaches the checklist from a button that says it will, which says the account exists", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(asAGuest);

    await createTheAccount(user);
    rerender(onceClaimed);

    // "Go to the group" sits beside it, and the checklist is not a group.
    expect(
      screen.getByRole("button", { name: "Go to the group" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish setting up" }));

    expect(screen.getByText("Account created")).toBeInTheDocument();
    // Opening the checklist did not leave for the group.
    expect(router.push).not.toHaveBeenCalled();
  });

  it("offers a passkey for next time, and ticks it once the ceremony ran", async () => {
    // An account that came in by a code has nothing on the next device but
    // an inbox. The moment after a successful sign-in is where most passkey
    // enrolments come from, so the list offers one, right under the account.
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(asAGuest);

    await createTheAccount(user);
    rerender(onceClaimed);
    await user.click(screen.getByRole("button", { name: "Finish setting up" }));

    const offer = screen.getByRole("button", {
      name: /Sign in faster next time/,
    });
    expect(offer).toBeInTheDocument();
    // The name-and-photo row opens something now too.
    expect(
      screen.getByRole("button", { name: /Name and photo/ }),
    ).toBeInTheDocument();

    await user.click(offer);

    expect(passkeyClient.registerPasskey).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Passkey saved")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Sign in faster next time/ }),
    ).toBeNull();
  });

  it("keeps the group it was a guest of on screen after the claim", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(asAGuest);

    await createTheAccount(user);
    rerender(onceClaimed);

    await user.click(screen.getByRole("button", { name: "Finish setting up" }));
    await user.click(screen.getByRole("button", { name: "Go to the group" }));

    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
  });
});
