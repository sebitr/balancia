import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The shell's keys: which fire, where, and when they are left alone.
 *
 * The sidebar is stood in for by the two controls the keys press — they are
 * found by their `data-shortcut` hook inside `[data-slot=app-sidebar]`, so the
 * stand-in only has to carry those. The width is `matchMedia`, answered here
 * as a desk unless a test says otherwise, and the platform is not a Mac
 * unless one says it is.
 */
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const { useShortcuts } = await import("./use-shortcuts");

const desk = { matches: true };
const fold = vi.fn();
const add = vi.fn();
const setPaletteOpen = vi.fn();

function Harness({
  groupId = "g1",
  paletteOpen = false,
}: {
  groupId?: string | null;
  paletteOpen?: boolean;
}) {
  useShortcuts({ groupId, paletteOpen, setPaletteOpen });
  return (
    <>
      <header data-slot="app-sidebar">
        <button type="button" data-shortcut="mod+backslash" onClick={fold}>
          Collapse the sidebar
        </button>
        <button type="button" data-shortcut="n" onClick={add}>
          Add expense
        </button>
      </header>
      <label>
        Description
        <input />
      </label>
      <button type="button">Somewhere on the screen</button>
    </>
  );
}

beforeEach(() => {
  desk.matches = true;
  window.matchMedia = ((query: string) => ({
    matches: query === "(min-width: 64rem)" && desk.matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(null, "", "/groups/g1");
});

afterEach(() => {
  vi.restoreAllMocks();
  router.push.mockClear();
  fold.mockClear();
  add.mockClear();
  setPaletteOpen.mockClear();
  document.cookie = "balancia_single_keys=; path=/; max-age=0";
});

/** A key pressed with the focus on the page itself, where it lands by default. */
function press(init: KeyboardEventInit) {
  return fireEvent.keyDown(document.body, init);
}

describe("⌘K", () => {
  it("opens the palette with Ctrl K off a Mac, and keeps the browser's own Ctrl K from firing", () => {
    render(<Harness />);
    const handled = !press({ key: "k", ctrlKey: true });
    expect(setPaletteOpen).toHaveBeenCalledWith(true);
    expect(handled).toBe(true);
  });

  it("opens it with ⌘K on a Mac, and leaves Ctrl K to the text field there", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    render(<Harness />);

    press({ key: "k", ctrlKey: true });
    expect(setPaletteOpen).not.toHaveBeenCalled();

    press({ key: "k", metaKey: true });
    expect(setPaletteOpen).toHaveBeenCalledWith(true);
  });

  it("works from a field, as a key with a modifier may", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("textbox", { name: "Description" }));
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(setPaletteOpen).toHaveBeenCalledWith(true);
  });

  it("closes the palette when it is the one open", () => {
    render(<Harness paletteOpen />);
    press({ key: "k", ctrlKey: true });
    expect(setPaletteOpen).toHaveBeenCalledWith(false);
  });

  it("does nothing under another dialog", () => {
    render(
      <>
        <Harness />
        <div role="dialog" data-state="open" aria-label="Add expense" />
      </>,
    );
    press({ key: "k", ctrlKey: true });
    expect(setPaletteOpen).not.toHaveBeenCalled();
  });
});

describe("N and S", () => {
  it("presses the sidebar's Add with N", () => {
    render(<Harness />);
    expect(press({ key: "n" })).toBe(false);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("goes to Settle up with S, inside a group", () => {
    render(<Harness groupId="g1" />);
    press({ key: "s" });
    expect(router.push).toHaveBeenCalledWith("/groups/g1/settle", {
      transitionTypes: ["push"],
    });
  });

  it("has nowhere to settle up outside a group", () => {
    render(<Harness groupId={null} />);
    expect(press({ key: "s" })).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("stays put on Settle up itself", () => {
    window.history.replaceState(null, "", "/groups/g1/settle");
    render(<Harness groupId="g1" />);
    press({ key: "s" });
    expect(router.push).not.toHaveBeenCalled();
  });

  it("leaves a letter typed into a field to the field", async () => {
    render(<Harness />);
    const field = screen.getByRole("textbox", { name: "Description" });
    await userEvent.click(field);
    await userEvent.keyboard("ns");

    expect(field).toHaveValue("ns");
    expect(add).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("leaves letters to a list with its own typeahead", () => {
    render(
      <>
        <Harness />
        <div role="listbox" tabIndex={0} aria-label="Currency" />
      </>,
    );
    screen.getByRole("listbox").focus();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "n" });
    expect(add).not.toHaveBeenCalled();
  });

  it("fires with the focus on a button, which takes no letters", () => {
    render(<Harness />);
    const button = screen.getByRole("button", {
      name: "Somewhere on the screen",
    });
    button.focus();
    fireEvent.keyDown(button, { key: "n" });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("does nothing while something is open over the screen", () => {
    render(
      <>
        <Harness />
        <div role="menu" data-state="open" aria-label="More" />
      </>,
    );
    press({ key: "n" });
    press({ key: "s" });
    expect(add).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("is a bare letter: Shift, Ctrl, ⌘ and Alt leave it alone", () => {
    render(<Harness />);
    press({ key: "N", shiftKey: true });
    press({ key: "n", ctrlKey: true });
    press({ key: "n", metaKey: true });
    press({ key: "n", altKey: true });
    expect(add).not.toHaveBeenCalled();
  });

  it("answers a held key once, not once per repeat", () => {
    render(<Harness />);
    press({ key: "n" });
    press({ key: "n", repeat: true });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("is off when the device's switch says so (WCAG 2.1.4)", () => {
    document.cookie = "balancia_single_keys=off; path=/";
    render(<Harness />);
    press({ key: "n" });
    press({ key: "s" });
    expect(add).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();

    // ⌘K has a modifier and is not the switch's to turn off.
    press({ key: "k", ctrlKey: true });
    expect(setPaletteOpen).toHaveBeenCalledWith(true);
  });
});

describe("⌘\\", () => {
  it("presses the sidebar's fold toggle", () => {
    render(<Harness />);
    press({ key: "\\", ctrlKey: true });
    expect(fold).toHaveBeenCalledTimes(1);
  });

  it("finds the key by its place where the layout types something else there", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    render(<Harness />);
    press({ key: "`", code: "Backslash", metaKey: true });
    expect(fold).toHaveBeenCalledTimes(1);
  });
});

describe("below lg", () => {
  it("answers nothing: no sidebar, no keys", () => {
    desk.matches = false;
    render(<Harness />);
    press({ key: "k", ctrlKey: true });
    press({ key: "n" });
    press({ key: "s" });
    press({ key: "\\", ctrlKey: true });

    expect(setPaletteOpen).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(fold).not.toHaveBeenCalled();
  });
});
