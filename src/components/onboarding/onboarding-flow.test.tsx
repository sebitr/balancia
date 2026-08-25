import { describe, expect, it, vi } from "vitest";
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// WebAuthn does not exist in jsdom, and the hook that asks is a fact about the
// environment rather than state — so it is stubbed rather than waited for.
vi.mock("@/components/auth/use-passkey-support", () => ({
  usePasskeySupport: () => true,
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
    expect(
      screen.getByRole("button", { name: "I already have an account" }),
    ).toBeInTheDocument();
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
    expect(
      screen.getByRole("button", { name: "I already have an account" }),
    ).toBeInTheDocument();
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
      screen.getByRole("heading", { name: "Where do I stand?" }),
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
