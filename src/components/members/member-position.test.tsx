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
  actions?: React.ReactNode,
) {
  return renderWithIntl(
    <MemberPosition
      position={view}
      name="Marta"
      mode={mode}
      actions={actions}
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

  /**
   * The settle screen's buttons for this pair go straight under the sentence
   * they act on, above the figures that are only context.
   */
  it("puts what the reader can do under the sentence it is about", () => {
    render(
      position({ between: "-96084" }),
      "between",
      "en",
      <button type="button">I paid Marta</button>,
    );

    const button = screen.getByRole("button", { name: "I paid Marta" });
    expect(button.previousElementSibling).toHaveTextContent("You owe Marta");
    expect(button.nextElementSibling?.tagName).toBe("DL");
  });

  describe("in plain words", () => {
    it("names whose balance the figure under the headline is", () => {
      render(
        position({
          between: "-96084",
          net: "197885",
          openCount: 2,
          openTotal: "197885",
        }),
        "between",
      );

      expect(
        screen.getByText("Marta's balance in this group"),
      ).toBeInTheDocument();
      expect(screen.getByText("Not settled with 2 people")).toBeInTheDocument();
      expect(screen.queryByText(/Net across/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Open with/)).not.toBeInTheDocument();
    });

    it("calls the reader's own figure their balance in this group", () => {
      render(position({ net: "-96084" }), "self");
      expect(
        screen.getByText("Your balance in this group"),
      ).toBeInTheDocument();
    });

    it("says the same in French without eliding a name", () => {
      render(
        position({ between: "-96084", net: "197885", openCount: 1 }),
        "between",
        "fr",
      );
      expect(
        screen.getByText("Solde dans ce groupe · Marta"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Pas à jour avec 1 personne"),
      ).toBeInTheDocument();
    });
  });

  /**
   * "CHF 1,979.…" under the headline was a balance with its last digits
   * missing. Nothing that holds a figure here truncates any more.
   */
  it("never cuts an amount short", () => {
    const { container } = render(
      position({
        between: "-1234567",
        net: "2345678",
        openCount: 4,
        openTotal: "2345678",
      }),
      "between",
    );

    expect(screen.getByText(/^CHF.12,345\.67$/)).toBeVisible();
    // Their balance, signed, and the total they are not settled with.
    expect(screen.getAllByText(/CHF.23,456\.78$/)).toHaveLength(2);
    expect(container.querySelector(".truncate")).toBeNull();
  });
});
