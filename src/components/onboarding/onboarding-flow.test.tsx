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

// The funnel counter is a fire-and-forget Server Action; what is checked
// here is that the flow names its screens, not that a registry counted them.
const recordOnboardingStepAction = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/modules/onboarding/actions", () => ({
  recordOnboardingStepAction,
}));

const auth = vi.hoisted(() => ({
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
  recordOnboardingStepAction.mockClear();
  passkeyDevice.platform = true;
  for (const action of Object.values(auth)) action.mockReset();
  auth.startCodeSignupAction.mockResolvedValue({ ok: true });
  auth.verifySignupCodeAction.mockResolvedValue({
    ok: true,
    data: { joinedGroupId: null, claimedGroupId: "group-1" },
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
    recentExpenses: [
      {
        id: "expense-1",
        description: "Fondue",
        minorUnits: "6400",
        currency: "CHF",
      },
    ],
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
  });
});

describe("the shared link", () => {
  it("asks who this is before it asks anything else", () => {
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    expect(
      screen.getByRole("button", { name: "Find myself in the list" }),
    ).toBeInTheDocument();
    // The account question is deferred to "keep it", where there is something
    // concrete to keep.
    expect(
      screen.queryByRole("button", { name: "Create an account" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Continue as a guest/ }),
    ).toBeNull();
  });

  it("shows each listed name with the balance that comes with it", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Find myself in the list" }),
    );

    expect(
      screen.getByRole("button", { name: /Marc T\. — 6 expenses filed/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /None of these/ }),
    ).toBeInTheDocument();
  });

  it("puts the expenses on screen before it asks anybody to claim them", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Find myself in the list" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Marc T\. — 6 expenses/ }),
    );

    expect(
      screen.getByRole("heading", { name: /Is this you\?/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Fondue")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yes, that's me" }));
    expect(
      screen.getByRole("heading", {
        name: /You're Marc T\. — how should we keep it\?/,
      }),
    ).toBeInTheDocument();
  });

  it("returns to the list from the confirmation, having un-chosen the name", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Find myself in the list" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Marc T\. — 6 expenses/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "No, show me the list again" }),
    );

    expect(
      screen.getByRole("button", { name: /Marc T\. — 6 expenses filed/ }),
    ).toBeInTheDocument();
  });

  it("joins as a guest on the tap that chooses it, and lands in the group", async () => {
    // This was the dead end: the guest option on a shared link committed
    // nothing, and "Go to the group" opened the sign-in page.
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Find myself in the list" }),
    );
    await user.click(screen.getByRole("button", { name: /None of these/ }));
    await user.type(screen.getByRole("textbox", { name: "Your name" }), "Dana");
    await user.click(
      screen.getByRole("button", { name: /^(Continue|Create my account)$/ }),
    );
    await user.click(
      screen.getByRole("button", { name: /Continue as a guest/ }),
    );

    expect(joinAsGuestAction).toHaveBeenCalledWith({
      participantId: null,
      displayName: "Dana",
    });
    expect(
      screen.getByRole("heading", { name: "You're in as a guest" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "See the group" }));
    await user.click(screen.getByRole("button", { name: "Go to the group" }));
    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
  });

  it("claims a listed name as a guest with that participant, not a new one", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Find myself in the list" }),
    );
    await user.click(screen.getByRole("button", { name: /Marc T\./ }));
    await user.click(screen.getByRole("button", { name: "Yes, that's me" }));
    await user.click(
      screen.getByRole("button", { name: /Continue as a guest/ }),
    );

    expect(joinAsGuestAction).toHaveBeenCalledWith({
      participantId: "member-1",
      displayName: "Marc T.",
    });
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

    await user.click(
      screen.getByRole("button", { name: "Find myself in the list" }),
    );
    await user.click(screen.getByRole("button", { name: /Marc T\./ }));
    await user.click(screen.getByRole("button", { name: "Yes, that's me" }));
    await user.click(
      screen.getByRole("button", { name: /Continue as a guest/ }),
    );

    expect(
      screen.getByText("Somebody else claimed that name first."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "You're in as a guest" }),
    ).toBeNull();
  });

  it("says so when the link no longer resolves", () => {
    renderWithIntl(<OnboardingFlow arrival="shared" group={null} linkGone />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Find myself in the list" }),
    ).toBeNull();
  });
});

describe("the cold arrival", () => {
  it("describes the product, because there is no group to describe", () => {
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);
    expect(
      screen.getByRole("heading", { name: "Keep your accounts within reach" }),
    ).toBeInTheDocument();
  });

  it("offers no guest option, having no group to be a guest of", () => {
    renderWithIntl(<OnboardingFlow arrival="cold" group={null} />);
    expect(
      screen.getByRole("button", { name: "Create an account" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Continue as a guest/ }),
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
    expect(recordOnboardingStepAction).toHaveBeenCalledWith({
      arrival: "cold",
      step: "welcome",
    });

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(recordOnboardingStepAction).toHaveBeenLastCalledWith({
      arrival: "cold",
      step: "identity",
    });

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

    expect(recordOnboardingStepAction).toHaveBeenLastCalledWith({
      arrival: "cold",
      step: "left",
    });
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

  it("keeps the password page a tap away where there is no mail server", async () => {
    // Before, the password link appeared only when neither a passkey nor a
    // code could be offered — so a mail-less instance read on a phone showed
    // exactly one button, and somebody who did not want a passkey had no
    // visible way to say so.
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
      screen.getByRole("link", { name: "Sign up with a password" }),
    ).toHaveAttribute("href", "/register/password");
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
 * so the link looked broken. They get the shared link's screens now — the
 * whole point being that the *identity* question is the only one left, since
 * they walked in holding the account the flow would have asked them to make.
 */
describe("the shared link, opened by somebody already signed in", () => {
  const account = { name: "Léa Martin", email: "lea@example.com" };

  it("runs the flow rather than sending them to the dashboard", () => {
    renderWithIntl(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        account={account}
      />,
    );

    expect(router.replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Find myself in the list" }),
    ).toBeInTheDocument();
  });

  it("says which account it is about to join as", () => {
    renderWithIntl(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        account={account}
      />,
    );

    // A link opened on a borrowed laptop is the case where somebody claims a
    // balance as the wrong person, so the account is named before they pick.
    expect(screen.getByText(/Signed in as Léa Martin/)).toBeInTheDocument();
  });

  it("joins the group as that account when a listed name is claimed", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        account={account}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Find myself in the list" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Marc T\. — 6 expenses/ }),
    );
    await user.click(screen.getByRole("button", { name: "Yes, that's me" }));

    // The participant is named; the group is not. It comes from the cookie on
    // the server, which is what stops a request naming any group it likes.
    expect(joinWithAccountAction).toHaveBeenCalledWith({
      participantId: "member-1",
      displayName: "Marc T.",
    });
    expect(
      screen.getByRole("heading", { name: /You're in, Marc T\./ }),
    ).toBeInTheDocument();
  });

  it("never asks them to keep it, or for a credential they already have", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        account={account}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Find myself in the list" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Marc T\. — 6 expenses/ }),
    );
    await user.click(screen.getByRole("button", { name: "Yes, that's me" }));

    expect(
      screen.queryByRole("heading", { name: /how should we keep it/ }),
    ).toBeNull();
    expect(screen.queryByPlaceholderText("you@example.com")).toBeNull();
  });

  it("files a new member under the typed name for somebody not on the list", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        account={account}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Find myself in the list" }),
    );
    await user.click(screen.getByRole("button", { name: /None of these/ }));

    // Prefilled from the account, because that is the likeliest answer — and
    // it is the participant's name being asked for, not the account's.
    const field = screen.getByPlaceholderText("Your name");
    await user.clear(field);
    await user.type(field, "Léa M.");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(joinWithAccountAction).toHaveBeenCalledWith({
      participantId: null,
      displayName: "Léa M.",
    });
    expect(
      screen.getByRole("heading", { name: /You're in, Léa/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Weekend in Verbier is on your account now/),
    ).toBeInTheDocument();
  });

  it("offers the account's own name to somebody who was not on the list", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        account={account}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Find myself in the list" }),
    );
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
    renderWithIntl(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        account={account}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Find myself in the list" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Marc T\. — 6 expenses/ }),
    );
    await user.click(screen.getByRole("button", { name: "Yes, that's me" }));

    expect(
      screen.getByText("Somebody else claimed that name first."),
    ).toBeInTheDocument();
    // Still standing on the confirmation, so the list is one tap away.
    expect(
      screen.getByRole("button", { name: "No, show me the list again" }),
    ).toBeInTheDocument();
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
 */
describe("what the checklist already knows", () => {
  const account = { name: "Léa Martin", email: "lea@example.com" };

  const everything = {
    hasPhoto: true,
    currencies: ["CHF", "EUR"],
    payouts: [{ method: "bank", detail: "CH93 0076 2011 6238 5295 7" }],
    pushEnabled: true,
  };

  /** Claims the listed name, which is the whole flow for a signed-in reader. */
  const claim = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(
      screen.getByRole("button", { name: "Find myself in the list" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Marc T\. — 6 expenses/ }),
    );
    await user.click(screen.getByRole("button", { name: "Yes, that's me" }));
  };

  it("never shows the screen to somebody who has all of it", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        account={account}
        profile={everything}
      />,
    );

    await claim(user);
    await user.click(screen.getByRole("button", { name: "See the group" }));

    expect(screen.queryByText("Finish setting up")).toBeNull();
    // Straight to the group, which is what the arrival screen's button says.
    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
  });

  it("still shows it when one thing is outstanding", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        account={account}
        profile={{ ...everything, hasPhoto: false }}
      />,
    );

    await claim(user);
    await user.click(screen.getByRole("button", { name: "See the group" }));

    expect(screen.getByText("Finish setting up")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("counts what was set up before as done, not as still to do", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        account={account}
        profile={{ ...everything, hasPhoto: false }}
      />,
    );

    await claim(user);
    await user.click(screen.getByRole("button", { name: "See the group" }));

    // Account, currencies, payouts and push: four of the five, from the
    // profile alone. Only the photo is left.
    expect(screen.getByText("4 of 5")).toBeInTheDocument();
    expect(screen.getByText("CHF · EUR")).toBeInTheDocument();
    expect(screen.getByText("Bank transfer")).toBeInTheDocument();
    expect(screen.getByText(/pushed to this device/)).toBeInTheDocument();
    expect(screen.getByText(/initials for now/)).toBeInTheDocument();
  });

  it("picks up a profile that only arrives once somebody signs in", async () => {
    // The mid-flow case: on a personal invitation the account does not exist
    // until they sign in, so the page cannot hand this down until then.
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        account={account}
        profile={null}
      />,
    );

    rerender(
      <OnboardingFlow
        arrival="shared"
        group={group}
        members={members}
        account={account}
        profile={everything}
      />,
    );

    await claim(user);
    await user.click(screen.getByRole("button", { name: "See the group" }));

    expect(screen.queryByText("Finish setting up")).toBeNull();
  });

  it("starts from zero for an account this flow just created", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingFlow arrival="shared" group={group} members={members} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Find myself in the list" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Marc T\. — 6 expenses/ }),
    );
    await user.click(screen.getByRole("button", { name: "Yes, that's me" }));

    // No account behind them, so nothing is ticked but the one row the flow
    // itself fills in — and the screen is very much still on the route.
    expect(
      screen.getByRole("heading", {
        name: /You're Marc T\. — how should we keep it\?/,
      }),
    ).toBeInTheDocument();
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
   * journey fell out of the route from under somebody halfway along it: "See
   * the group" left for the group itself, and the checklist — the one screen
   * that says the account now exists — was never shown at all.
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

  it("reaches the checklist, with the account row no longer a warning", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(asAGuest);

    await createTheAccount(user);
    rerender(onceClaimed);

    await user.click(screen.getByRole("button", { name: "See the group" }));

    expect(screen.getByText("Account created")).toBeInTheDocument();
    expect(screen.queryByText("Claim your account")).toBeNull();
    // Leaving is the checklist's own button's job, not this one's.
    expect(router.push).not.toHaveBeenCalled();
  });

  it("keeps the group it was a guest of on screen after the claim", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(asAGuest);

    await createTheAccount(user);
    rerender(onceClaimed);

    await user.click(screen.getByRole("button", { name: "See the group" }));
    await user.click(screen.getByRole("button", { name: "Go to the group" }));

    expect(router.push).toHaveBeenCalledWith("/groups/group-1");
  });
});
