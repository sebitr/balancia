import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

/**
 * The browser's half of leaving the desk-only reads out on a phone: it says
 * how wide the window is, for the next render, and asks for this one again
 * only when this one was drawn for a phone and the window is now a desk's.
 * See `narrow-window.ts`.
 */

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { NarrowWindowHint } = await import("./narrow-window-hint");

const originalMatchMedia = window.matchMedia;

/** Stands the window at a desk's width or a phone's. */
function windowIs(width: "desk" | "phone") {
  window.matchMedia = ((query: string) => ({
    matches: width === "desk",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function hint(): string | undefined {
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith("balancia_narrow="))
    ?.slice("balancia_narrow=".length);
}

beforeEach(() => {
  document.cookie = "balancia_narrow=; path=/; max-age=0";
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  router.refresh.mockClear();
});

describe("NarrowWindowHint", () => {
  it("records a phone's window for the next render, and asks for nothing now", () => {
    windowIs("phone");
    render(<NarrowWindowHint leftOut={false} />);

    expect(hint()).toBe("1");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("clears the hint at a desk's width, and leaves a whole render alone", () => {
    document.cookie = "balancia_narrow=1; path=/";
    windowIs("desk");
    render(<NarrowWindowHint leftOut={false} />);

    expect(hint()).toBeUndefined();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("asks once for a render that was drawn for a phone, now at a desk", () => {
    document.cookie = "balancia_narrow=1; path=/";
    windowIs("desk");
    const { rerender } = render(<NarrowWindowHint leftOut />);
    rerender(<NarrowWindowHint leftOut />);

    expect(hint()).toBeUndefined();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not ask when the hint cannot be cleared, so it never loops", () => {
    windowIs("desk");
    // A browser that keeps the cookie whatever the page writes: an own
    // property shadowing the prototype's accessor, removed afterwards.
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "balancia_narrow=1",
      set: () => {},
    });
    try {
      render(<NarrowWindowHint leftOut />);
    } finally {
      Reflect.deleteProperty(document, "cookie");
    }

    expect(router.refresh).not.toHaveBeenCalled();
  });
});
