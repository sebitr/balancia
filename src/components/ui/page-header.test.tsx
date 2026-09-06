import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader, PageHeaderClose } from "./page-header";

/**
 * That the arrow decides the shape.
 *
 * `<PageHeader>` takes no size: a screen says whether it was pushed here from
 * somewhere else, and the title follows. Written down because the two shapes
 * are one ternary apart, and a screen that opens on a `text-2xl` title beside
 * a back arrow is the exact regression the settings hub was drawn to avoid.
 */
describe("a page header", () => {
  it("titles a pushed screen as a row label beside its arrow", () => {
    render(
      <PageHeader
        title="Statistics"
        back={{ href: "/groups/g1", label: "Back to the group" }}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("text-base");
    expect(
      screen.getByRole("link", { name: "Back to the group" }),
    ).toHaveAttribute("href", "/groups/g1");
  });

  it("gives a screen that was not pushed here the room to name itself", () => {
    render(<PageHeader title="Settings" />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveClass("text-2xl");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps the row's height when the screen names itself below", () => {
    // A screen whose own hero carries its name leaves the header with the
    // arrow and nothing else — and it still has to hold its line.
    const { container } = render(
      <PageHeader back={{ href: "/groups/g1", label: "Back to the group" }} />,
    );

    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector(".min-h-8\\.5")).not.toBeNull();
  });

  it("keeps a badge against the words rather than at the far end", () => {
    // A member's screen titles itself with a person and badges them "You" or
    // "Owner" — which says what the title names, so it reads as part of the
    // title, and the truncation stays the name's alone.
    render(
      <PageHeader
        title="Ada Lovelace"
        back={{ href: "/groups/g1", label: "Back to the group" }}
        badge={<span>You</span>}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveClass("truncate");
    expect(heading).not.toHaveClass("flex-1");
    expect(heading.nextElementSibling).toHaveTextContent("You");
  });

  it("puts a trailing control at the far end of the same row", () => {
    render(
      <PageHeader
        title="Settings"
        trailing={<PageHeaderClose href="/dashboard" label="Close settings" />}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Close settings" }),
    ).toHaveAttribute("href", "/dashboard");
  });
});
