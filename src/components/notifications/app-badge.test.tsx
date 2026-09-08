import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { AppBadge } from "./app-badge";

/**
 * The count on the installed app's icon.
 *
 * Every assertion here is about a platform that may not be there. The Badging
 * API is missing entirely in Firefox and present-but-refusing in an iOS web
 * app that has not been installed, and neither is a fault worth surfacing — so
 * what is tested is mostly that nothing happens loudly.
 */

const setAppBadge = vi.fn<(count?: number) => Promise<void>>(
  async () => undefined,
);
const clearAppBadge = vi.fn<() => Promise<void>>(async () => undefined);

function grantBadging() {
  Object.defineProperty(navigator, "setAppBadge", {
    configurable: true,
    writable: true,
    value: setAppBadge,
  });
  Object.defineProperty(navigator, "clearAppBadge", {
    configurable: true,
    writable: true,
    value: clearAppBadge,
  });
}

function withdrawBadging() {
  // @ts-expect-error — removing a method the DOM lib says is always there is
  // the whole point: this is the Firefox case.
  delete navigator.setAppBadge;
  // @ts-expect-error — as above.
  delete navigator.clearAppBadge;
}

beforeEach(() => {
  vi.clearAllMocks();
  grantBadging();
});

afterEach(() => {
  withdrawBadging();
});

describe("badging the app icon", () => {
  it("writes the unread count", () => {
    render(<AppBadge count={3} />);

    expect(setAppBadge).toHaveBeenCalledWith(3);
    expect(clearAppBadge).not.toHaveBeenCalled();
  });

  /**
   * Not `setAppBadge(0)`. The spec says that clears it; the platforms disagree
   * in practice and some draw a dot for it, which is exactly what an emptied
   * inbox should not leave on the home screen.
   */
  it("clears rather than setting zero", () => {
    render(<AppBadge count={0} />);

    expect(clearAppBadge).toHaveBeenCalled();
    expect(setAppBadge).not.toHaveBeenCalled();
  });

  it("follows the count as it changes", () => {
    const { rerender } = render(<AppBadge count={2} />);
    rerender(<AppBadge count={5} />);

    expect(setAppBadge).toHaveBeenLastCalledWith(5);
  });

  it("does nothing at all where the platform has no badge", () => {
    withdrawBadging();

    expect(() => render(<AppBadge count={3} />)).not.toThrow();
    expect(setAppBadge).not.toHaveBeenCalled();
  });

  /**
   * An uninstalled iOS web app rejects with `NotAllowedError`. Unhandled, that
   * is an error in the console of every page with a header on it.
   */
  it("swallows a refusal from the platform", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    setAppBadge.mockRejectedValueOnce(new Error("NotAllowedError"));

    render(<AppBadge count={3} />);
    // Node decides a rejection is unhandled at the end of the turn, so the
    // check has to come after one — a plain `await` is not far enough.
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", unhandled);

    expect(setAppBadge).toHaveBeenCalledWith(3);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
