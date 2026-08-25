import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { SettlementSuggestionView } from "./settlement-list";

/**
 * What the detail sheet leaves behind when it hands over to the drawer.
 *
 * The sheet is a modal, and the screen it opens onto is another one: recording
 * a payment navigates to the add-entry drawer, which rises over the same group
 * this sheet is sitting on. A modal that stays open through that navigation is
 * invisible — the drawer covers it — right up until the drawer is dismissed,
 * at which point its overlay is the topmost thing on the screen and every tap
 * on the group underneath lands on it instead. The bottom bar's Add stops
 * working, and so does everything else, with nothing on screen to say why.
 */

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    transitionTypes,
    onClick,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    transitionTypes?: string[];
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a
      href={href}
      data-transition={transitionTypes?.join(" ")}
      onClick={(event) => {
        // jsdom has nowhere to navigate to; the component's own handler is
        // what these tests are about, and it still runs.
        event.preventDefault();
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

const { SettlementList } = await import("./settlement-list");

/** Somebody else's debt: the row that opens the sheet rather than the drawer. */
const BLAISE_OWES_ADA: SettlementSuggestionView = {
  fromParticipantId: "p-blaise",
  fromName: "Blaise",
  toParticipantId: "p-ada",
  toName: "Ada",
  currency: "EUR",
  minorUnits: "12514",
  fromIsSelf: false,
  toIsSelf: false,
};

async function openDetailSheet() {
  const user = userEvent.setup();
  renderWithIntl(
    <SettlementList
      suggestions={[BLAISE_OWES_ADA]}
      groupId="g1"
      groupName="Lisbon trip"
      senderName="Grace"
      recipients={[]}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Blaise/ }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  return user;
}

describe("SettlementList", () => {
  it("records against the debt the sheet was opened on", async () => {
    await openDetailSheet();

    expect(
      screen.getByRole("link", { name: "Record payment" }),
    ).toHaveAttribute(
      "href",
      "/groups/g1/expenses/new?settleFrom=p-blaise&settleTo=p-ada&settleIn=EUR",
    );
  });

  it("closes the sheet on the way into the drawer", async () => {
    const user = await openDetailSheet();

    await user.click(screen.getByRole("link", { name: "Record payment" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
