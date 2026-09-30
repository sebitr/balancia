import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CodeInput } from "./code-input";

/**
 * Where the six code boxes show focus.
 *
 * The field holding the caret is invisible, stretched over boxes that are only
 * drawn, and it said `outline-none` — so a keyboard reached it and nothing on
 * screen changed; the coral border on the next box is there with or without
 * focus. jsdom has no `:focus-visible` to match, so what is pinned is that the
 * next box, and only that one, asks for the ring while the field has it.
 */
describe("the code boxes", () => {
  it("ring the next box to fill while the field has focus", () => {
    render(<CodeInput value="12" onChange={vi.fn()} label="Code" />);

    const field = screen.getByLabelText("Code");
    const wrapper = field.parentElement;
    expect(wrapper?.className).toContain("group/code");

    const boxes = [...(wrapper?.querySelectorAll("[aria-hidden] > div") ?? [])];
    expect(boxes).toHaveLength(6);
    const ringed = boxes.filter((box) =>
      box.className.includes("group-has-[input:focus-visible]/code:ring-3"),
    );
    expect(ringed).toEqual([boxes[2]]);
  });
});
