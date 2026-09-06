import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { GroupEmptyState, type StartHerePerson } from "./group-empty-state";

/**
 * The overview of a group nobody has spent anything in yet.
 *
 * What is worth holding here is not the layout but the offer: "Start here"
 * replaced a paragraph of directions with the two steps themselves, and each
 * of the three ways it can be wrong is a step the reader cannot take. So the
 * tests are the three shapes — a group with people and a live link, a group
 * whose reader may not see the link, and a creator still on their own — plus
 * the rule that there is never more than one way to copy one link.
 */

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    transitionTypes,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    transitionTypes?: string[];
  }) => (
    <a href={href} data-transition={transitionTypes?.join(" ")} {...rest}>
      {children}
    </a>
  ),
}));

const URL = "https://balancia.test/join/g/SECRET-TOKEN";
const NOW = "2026-09-06T10:00:00.000Z";
const IN_A_WEEK = "2026-09-13T10:00:00.000Z";

const PEOPLE: readonly StartHerePerson[] = [
  { participantId: "p1", name: "Seb Trosset", isSelf: true },
  { participantId: "p2", name: "Marie", isSelf: false },
  { participantId: "p3", name: "Léo Bertrand", isSelf: false },
  { participantId: "p4", name: "Sam", isSelf: false },
];

function renderEmpty(
  overrides: Partial<React.ComponentProps<typeof GroupEmptyState>> = {},
) {
  renderWithIntl(
    <GroupEmptyState
      groupId="g1"
      groupName="Lisbon, March"
      canImport={false}
      people={PEOPLE}
      invite={{ url: URL, expiresAt: IN_A_WEEK }}
      now={NOW}
      {...overrides}
    />,
  );
}

/** jsdom has no share sheet, so the browsers that do have to be played. */
function withShareSheet() {
  Object.defineProperty(navigator, "share", {
    value: vi.fn(async () => {}),
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "share");
});

describe("GroupEmptyState", () => {
  it("asks for one expense and leaves importing as an aside", () => {
    renderEmpty({ canImport: true });

    expect(
      screen.getByRole("heading", { name: "No expenses yet" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Add an expense" }).getAttribute("href"),
    ).toBe("/groups/g1/expenses/new");
    expect(
      screen
        .getByRole("link", { name: "Import from Splitwise" })
        .getAttribute("href"),
    ).toBe("/groups/g1/import");
  });

  it("offers no import where the reader cannot import", () => {
    renderEmpty();

    expect(
      screen.queryByRole("link", { name: "Import from Splitwise" }),
    ).toBeNull();
  });

  it("counts the group and names it, the reader first", () => {
    renderEmpty();

    const roster = screen.getByRole("link", { name: /4 people/ });
    expect(roster.getAttribute("href")).toBe("/groups/g1/members");
    expect(roster.textContent).toContain("You, Marie, Léo Bertrand, Sam");
  });

  it("hands over the link itself, with what is left of its life", () => {
    withShareSheet();
    renderEmpty();

    expect(screen.getByText("balancia.test/join/g/SECRET-TOKEN")).toBeTruthy();
    expect(screen.getByText("Expires in 7 days")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });

  it("copies from inside the chip", async () => {
    withShareSheet();
    const user = userEvent.setup();
    renderEmpty();

    await user.click(screen.getByRole("button", { name: "Copy the link" }));

    expect(await navigator.clipboard.readText()).toBe(URL);
  });

  it("never shows two ways to copy one link", async () => {
    // No share sheet: the share button would open nothing, so it goes and the
    // copy button inside the chip says the word out loud instead.
    const user = userEvent.setup();
    renderEmpty();

    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await navigator.clipboard.readText()).toBe(URL);
  });

  it("still says who is here when there is no link to show", () => {
    renderEmpty({ invite: null });

    expect(screen.getByRole("link", { name: /4 people/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    expect(screen.queryByText(/balancia.test/)).toBeNull();
  });

  it("asks a creator who is still alone for names, not for a link", () => {
    renderEmpty({ people: [PEOPLE[0]] });

    expect(screen.getByText("You're on your own here")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Add people" }).getAttribute("href"),
    ).toBe("/groups/g1/members");
    expect(screen.getByText("The guest link comes right after.")).toBeTruthy();

    // There is nobody to send it to, so the link is not offered — even though
    // the group has one and the reader is allowed to see it.
    expect(screen.queryByText(/balancia.test/)).toBeNull();
    expect(screen.queryByText("1 person")).toBeNull();
  });
});
