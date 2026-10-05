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

/** The reader, Ada, owes Marta: the row that goes straight to the drawer. */
const ADA_OWES_MARTA: SettlementSuggestionView = {
  fromParticipantId: "p-ada",
  fromName: "Ada",
  toParticipantId: "p-marta",
  toName: "Marta",
  currency: "CHF",
  minorUnits: "96084",
  fromIsSelf: true,
  toIsSelf: false,
};

/** Sam owes the reader. */
const SAM_OWES_ADA: SettlementSuggestionView = {
  fromParticipantId: "p-sam",
  fromName: "Sam",
  toParticipantId: "p-ada",
  toName: "Ada",
  currency: "CHF",
  minorUnits: "1200",
  fromIsSelf: false,
  toIsSelf: true,
};

function renderList(
  suggestions: readonly SettlementSuggestionView[],
  locale: "en" | "fr" = "en",
) {
  return renderWithIntl(
    <SettlementList
      suggestions={suggestions}
      groupId="g1"
      groupName="Lisbon trip"
      senderName="Ada"
      recipients={[]}
    />,
    { locale },
  );
}

/**
 * A transfer is a sentence from the reader's side of it. It used to be two
 * faces and an arrow — "Ada → Marta" — which said nothing about which of the
 * two was the reader, even when Ada was the one reading.
 */
describe("SettlementList's sentences", () => {
  it("says You pay on the reader's own debt, and leads to the drawer", () => {
    renderList([ADA_OWES_MARTA]);

    const row = screen.getByRole("link", { name: /You pay Marta back/ });
    expect(row).toHaveAttribute(
      "href",
      "/groups/g1/expenses/new#settleFrom=p-ada&settleTo=p-marta&settleIn=CHF",
    );
    expect(row).not.toHaveTextContent("→");
    expect(screen.queryByText("Ada")).toBeNull();
  });

  it("says pays you back on a debt owed to the reader", () => {
    renderList([SAM_OWES_ADA]);

    expect(
      screen.getByRole("button", { name: /Sam pays you back/ }),
    ).toBeVisible();
  });

  it("names both people on a debt between two others", () => {
    renderList([BLAISE_OWES_ADA]);

    expect(
      screen.getByRole("button", { name: /Blaise pays Ada back/ }),
    ).toBeVisible();
  });

  it("puts a chevron on every row, since every row opens something", () => {
    renderList([ADA_OWES_MARTA, SAM_OWES_ADA, BLAISE_OWES_ADA]);

    for (const row of screen.getAllByRole("listitem")) {
      expect(row.querySelector(".lucide-chevron-right")).not.toBeNull();
    }
  });

  it("colours the figure the way the settle-up screen does", () => {
    renderList([ADA_OWES_MARTA, SAM_OWES_ADA, BLAISE_OWES_ADA]);

    expect(screen.getByText("CHF 960.84")).toHaveClass("text-negative-ink");
    expect(screen.getByText("CHF 12.00")).toHaveClass("text-positive-ink");
    expect(screen.getByText("EUR 125.14")).toHaveClass(
      "text-neutral-balance-ink",
    );
  });

  it("titles the sheet with the same sentence", async () => {
    const user = userEvent.setup();
    renderList([SAM_OWES_ADA]);

    await user.click(screen.getByRole("button", { name: /Sam pays you back/ }));

    expect(
      screen.getByRole("heading", { name: "Sam pays you back" }),
    ).toBeVisible();
  });

  it("speaks French as whole sentences", () => {
    renderList([ADA_OWES_MARTA, SAM_OWES_ADA], "fr");

    expect(screen.getByText("Tu rembourses Marta")).toBeVisible();
    expect(screen.getByText("Sam te rembourse")).toBeVisible();
  });
});

describe("SettlementList", () => {
  it("records against the debt the sheet was opened on", async () => {
    await openDetailSheet();

    expect(
      screen.getByRole("link", { name: "Record repayment" }),
    ).toHaveAttribute(
      "href",
      "/groups/g1/expenses/new#settleFrom=p-blaise&settleTo=p-ada&settleIn=EUR",
    );
  });

  it("closes the sheet on the way into the drawer", async () => {
    const user = await openDetailSheet();

    await user.click(screen.getByRole("link", { name: "Record repayment" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
