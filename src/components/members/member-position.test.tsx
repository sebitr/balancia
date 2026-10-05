import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import {
  MemberPosition,
  type PositionMode,
  type PositionView,
} from "./member-position";

/**
 * The hero on a person's page.
 *
 * It used to be an eyebrow, an arrow and a coloured figure — "BETWEEN YOU TWO
 * ↓ CHF 960.84" in red — with the sentence that explained it read out to a
 * screen reader and never drawn. "Between you two" says who, not which way, so
 * a sighted reader was left to decode the colour. The sentence is on screen
 * now, and the arrow is the one pair the rest of the app uses.
 */

function position(overrides: Partial<PositionView> = {}): PositionView {
  return {
    currency: "CHF",
    net: "0",
    between: "0",
    owedBy: "0",
    owes: "0",
    owedByCount: 0,
    owesCount: 0,
    openCount: 0,
    openTotal: "0",
    largestDebtTo: null,
    ...overrides,
  };
}

function render(
  view: PositionView,
  mode: PositionMode,
  locale: "en" | "fr" = "en",
) {
  return renderWithIntl(
    <MemberPosition
      position={view}
      groupName="Lisbon"
      name="Marta"
      mode={mode}
    />,
    { locale },
  );
}

/** The figure's own line: the paragraph holding the arrow and the amount. */
function figure(): HTMLElement {
  return screen.getByText("CHF 960.84").closest("p")!;
}

describe("MemberPosition", () => {
  it("says You owe Marta under the figure, between you two", () => {
    render(position({ between: "-96084" }), "between");

    expect(screen.getByText("You owe Marta")).toBeVisible();
    expect(screen.getByText("You owe Marta")).not.toHaveClass("sr-only");
    expect(figure()).toHaveClass("text-negative-ink");
  });

  it("says Marta owes you the other way round", () => {
    render(position({ between: "1200" }), "between");

    expect(screen.getByText("Marta owes you")).toBeVisible();
    expect(screen.getByText("CHF 12.00").closest("p")).toHaveClass(
      "text-positive-ink",
    );
  });

  it("phrases a settled pair instead of printing a zero", () => {
    render(position({ between: "0" }), "between");

    const headline = screen.getByText("You and Marta are settled up");
    expect(headline).toBeVisible();
    expect(headline).toHaveClass("text-neutral-balance-ink");
    // The headline is the sentence alone; the figures below it are context.
    expect(headline.previousElementSibling?.tagName).toBe("H2");
    expect(headline.nextElementSibling?.tagName).toBe("DL");
  });

  it("speaks to the reader on their own page", () => {
    render(position({ net: "-96084" }), "self");
    expect(screen.getByText("You owe")).toBeVisible();
  });

  it("names the person when neither side is the reader", () => {
    render(position({ net: "96084" }), "member");
    expect(screen.getByText("Marta gets back")).toBeVisible();
  });

  /**
   * The same debt used to point up on the group's screen and down on this
   * one. Both use the app's one pair now: down and left for money coming in,
   * up and right for money going out.
   */
  it("points the arrow the way the rest of the app does", () => {
    const { unmount } = render(position({ between: "-96084" }), "between");
    expect(figure().querySelector(".lucide-arrow-up-right")).not.toBeNull();
    unmount();

    render(position({ between: "96084" }), "between");
    expect(figure().querySelector(".lucide-arrow-down-left")).not.toBeNull();
  });

  it("drops the sign from a figure the sentence explains", () => {
    render(position({ between: "-96084" }), "between");
    expect(figure()).not.toHaveTextContent("−");
  });

  it("writes French as whole sentences", () => {
    render(position({ between: "-96084" }), "between", "fr");
    expect(screen.getByText("Tu dois à Marta")).toBeVisible();
  });

  it("writes a settled pair in French with tu, not vous", () => {
    render(position({ between: "0" }), "between", "fr");
    expect(screen.getByText("Marta et toi êtes à jour")).toBeVisible();
  });
});
