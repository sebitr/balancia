import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Avatar, AvatarFallback } from "./avatar";
import { avatarHue } from "./avatar-hue";
import { FaceHuesProvider, useFaceHue } from "./face-hues";

function face(hueKey: string) {
  return (
    <Avatar>
      <AvatarFallback hueKey={hueKey}>K</AvatarFallback>
    </Avatar>
  );
}

describe("AvatarFallback inside a group", () => {
  it("wears the hue the group layout worked out for that participant", () => {
    const { container } = render(
      <FaceHuesProvider hues={{ "participant-1": 345 }}>
        {face("participant-1")}
      </FaceHuesProvider>,
    );
    expect(
      container.querySelector('[data-slot="avatar-fallback"]'),
    ).toHaveAttribute("data-avatar-hue", "345");
  });

  it("hashes a key the layout did not list", () => {
    const { container } = render(
      <FaceHuesProvider hues={{}}>{face("someone-else")}</FaceHuesProvider>,
    );
    expect(
      container.querySelector('[data-slot="avatar-fallback"]'),
    ).toHaveAttribute("data-avatar-hue", String(avatarHue("someone-else")));
  });
});

function Drawn({ id }: { id?: string }) {
  return <span data-testid="drawn" {...useFaceHue(id)} />;
}

describe("useFaceHue", () => {
  it("gives a hand-drawn face the same hue as an avatar would get", () => {
    const { getByTestId } = render(
      <FaceHuesProvider hues={{ "participant-1": 225 }}>
        <Drawn id="participant-1" />
      </FaceHuesProvider>,
    );
    expect(getByTestId("drawn")).toHaveAttribute("data-avatar-hue", "225");
  });

  it("leaves a face with no key plain", () => {
    const { getByTestId } = render(<Drawn />);
    expect(getByTestId("drawn")).not.toHaveAttribute("data-avatar-hue");
  });
});
