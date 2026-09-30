import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { rovingChoice } from "./roving-choice";

/**
 * The keyboard a hand-drawn radio group or tab list owes.
 *
 * Checked through a minimal group rather than through any one screen, so what
 * is pinned is the contract every caller relies on: one Tab stop, the arrows
 * moving and choosing, disabled items stepped over, and a grid moving by rows.
 * The screens that use it each have a test of their own that it is wired in.
 */

const LETTERS = ["a", "b", "c", "d", "e", "f"] as const;
type Letter = (typeof LETTERS)[number];

function Group({
  initial = null,
  disabled = [],
  columns,
}: {
  initial?: Letter | null;
  disabled?: readonly Letter[];
  columns?: number;
}) {
  const [value, setValue] = useState<Letter | null>(initial);
  const keys = rovingChoice({
    values: LETTERS,
    selected: value,
    onSelect: setValue,
    isDisabled: (letter) => disabled.includes(letter),
    columns,
  });
  return (
    <>
      <button type="button">before</button>
      <div role="radiogroup" aria-label="Letters">
        {LETTERS.map((letter) => (
          // Wrapped, as several of the real ones are: the group is found from
          // the key press, not from the item's parent.
          <span key={letter}>
            <button
              type="button"
              role="radio"
              aria-checked={letter === value}
              disabled={disabled.includes(letter)}
              {...keys(letter)}
              onClick={() => setValue(letter)}
            >
              {letter}
            </button>
          </span>
        ))}
      </div>
      <button type="button">after</button>
    </>
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("a hand-drawn radio group", () => {
  it("is one stop on the Tab key, landing on the chosen item", async () => {
    const user = userEvent.setup();
    render(<Group initial="c" />);

    await user.click(screen.getByRole("button", { name: "before" }));
    await user.tab();
    expect(radio("c")).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
  });

  it("lands on the first item while nothing is chosen", async () => {
    const user = userEvent.setup();
    render(<Group />);

    await user.click(screen.getByRole("button", { name: "before" }));
    await user.tab();
    expect(radio("a")).toHaveFocus();
  });

  it("moves and chooses with the arrows, wrapping at either end", async () => {
    const user = userEvent.setup();
    render(<Group initial="e" />);
    radio("e").focus();

    await user.keyboard("{ArrowRight}");
    expect(radio("f")).toHaveFocus();
    expect(radio("f")).toBeChecked();

    await user.keyboard("{ArrowDown}");
    expect(radio("a")).toHaveFocus();
    expect(radio("a")).toBeChecked();

    await user.keyboard("{ArrowLeft}");
    expect(radio("f")).toBeChecked();

    await user.keyboard("{ArrowUp}");
    expect(radio("e")).toBeChecked();
    expect(radio("f")).not.toBeChecked();
  });

  it("goes to either end with Home and End", async () => {
    const user = userEvent.setup();
    render(<Group initial="c" />);
    radio("c").focus();

    await user.keyboard("{End}");
    expect(radio("f")).toHaveFocus();
    expect(radio("f")).toBeChecked();

    await user.keyboard("{Home}");
    expect(radio("a")).toHaveFocus();
    expect(radio("a")).toBeChecked();
  });

  it("steps over an item that cannot be chosen", async () => {
    const user = userEvent.setup();
    render(<Group initial="a" disabled={["b"]} />);
    radio("a").focus();

    await user.keyboard("{ArrowRight}");
    expect(radio("c")).toHaveFocus();
    expect(radio("c")).toBeChecked();
    expect(radio("b")).not.toBeChecked();
  });

  it("moves a row at a time up and down a grid", async () => {
    const user = userEvent.setup();
    render(<Group initial="b" columns={3} />);
    radio("b").focus();

    await user.keyboard("{ArrowDown}");
    expect(radio("e")).toHaveFocus();
    expect(radio("e")).toBeChecked();

    // The bottom row has nowhere further down to go, and does not wrap.
    await user.keyboard("{ArrowDown}");
    expect(radio("e")).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(radio("b")).toBeChecked();
  });

  it("leaves a key it does not own to the page", async () => {
    const user = userEvent.setup();
    render(<Group initial="a" />);
    radio("a").focus();

    await user.keyboard("{Enter}");
    await user.keyboard("x");
    expect(radio("a")).toHaveFocus();
    expect(radio("a")).toBeChecked();
  });
});
