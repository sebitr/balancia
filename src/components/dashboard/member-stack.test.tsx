import { describe, expect, it } from "vitest";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { MemberStack } from "./member-stack";

/**
 * The home screen's faces. The reader is a different participant in every
 * group, so a hue keyed by that id would colour them differently on each row;
 * their slot arrives empty and keeps the plain "you" face instead.
 */
describe("MemberStack", () => {
  it("gives everybody but the reader a hue", () => {
    const { container } = renderWithIntl(
      <MemberStack
        names={["Demo", "Katherine"]}
        ids={["", "8d6b1c52-5e0f-4c4f-9a1c-2f1b8e1f7a10"]}
        total={2}
      />,
    );

    const faces = [
      ...container.querySelectorAll('[data-slot="avatar-fallback"]'),
    ];
    expect(faces).toHaveLength(2);
    expect(faces[0]).not.toHaveAttribute("data-avatar-hue");
    expect(faces[1]).toHaveAttribute("data-avatar-hue");
  });

  it("falls back to the name when no ids are given", () => {
    const { container } = renderWithIntl(
      <MemberStack names={["Demo"]} total={1} />,
    );

    expect(
      container.querySelector('[data-slot="avatar-fallback"]'),
    ).toHaveAttribute("data-avatar-hue");
  });
});
