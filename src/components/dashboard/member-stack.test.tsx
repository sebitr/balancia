import { describe, expect, it } from "vitest";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { MemberStack } from "./member-stack";

/**
 * The home screen's faces. Their hues arrive worked out on the server, from
 * each person's account where they have one, so somebody in several of the
 * reader's groups is one colour on every row. The reader's slot is null and
 * keeps the plain "you" face, as on every group screen.
 */
describe("MemberStack", () => {
  it("paints the hues it is given and leaves the reader plain", () => {
    const { container } = renderWithIntl(
      <MemberStack
        names={["Demo", "Katherine"]}
        hues={[null, 250]}
        total={2}
      />,
    );

    const faces = [
      ...container.querySelectorAll('[data-slot="avatar-fallback"]'),
    ];
    expect(faces).toHaveLength(2);
    expect(faces[0]).not.toHaveAttribute("data-avatar-hue");
    expect(faces[1]).toHaveAttribute("data-avatar-hue", "250");
  });

  it("falls back to the name when no hues are given", () => {
    const { container } = renderWithIntl(
      <MemberStack names={["Demo"]} total={1} />,
    );

    expect(
      container.querySelector('[data-slot="avatar-fallback"]'),
    ).toHaveAttribute("data-avatar-hue");
  });
});
