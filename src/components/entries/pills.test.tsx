import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { expectLabelInName } from "../../../tests/helpers/label-in-name";
import { MemberPill } from "./pills";

/**
 * A person's pill in the split: named for what pressing it does, and showing
 * nothing that name leaves out.
 *
 * "Paid by you" and "Include Blaise in the split" are names the pill shows
 * only part of, which is allowed — but the face's initial used to be written
 * into the pill beside the name, so it read "AYou" to anybody comparing what
 * it shows with what it is called, and axe failed the entry form on every
 * pill (label-content-name-mismatch, in the Playwright journeys).
 */
describe("MemberPill", () => {
  it("shows only words its name says, the initial being drawn", () => {
    render(
      <MemberPill
        name="Ada Lovelace"
        shownAs="You"
        label="Paid by you"
        selected
        choice
        onToggle={() => {}}
      />,
    );

    const pill = screen.getByRole("radio", { name: "Paid by you" });
    expectLabelInName(pill, "Paid by you");
    expect(pill.querySelector("[data-initials]")).toHaveAttribute(
      "data-initials",
      "A",
    );
  });

  it("does the same for somebody else, by name", () => {
    render(
      <MemberPill
        name="Blaise"
        label="Include Blaise in the split"
        selected={false}
        onToggle={() => {}}
      />,
    );

    expectLabelInName(
      screen.getByRole("button", { name: "Include Blaise in the split" }),
      "Include Blaise in the split",
    );
  });

  it("leads with the word it shows when its label does not hold it", () => {
    render(
      <MemberPill
        name="Ada Lovelace"
        shownAs="You"
        label="Include yourself in the split"
        selected
        onToggle={() => {}}
      />,
    );

    // "yourself" is not "You": the label alone was a name the pill did not
    // show, and axe failed the entry form on it.
    const name = "You, Include yourself in the split";
    expectLabelInName(screen.getByRole("button", { name }), name);
  });
});
