import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { act } from "react";
import { RefreshOnReturn } from "./refresh-on-return";

/**
 * Coming back to a screen that has been sitting behind another app.
 *
 * The whole behaviour is a judgement about *how long* away counts, so the
 * clock is the thing under test. Time is faked rather than waited on, and the
 * visibility state is written directly — jsdom fires nothing on its own.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
}));

/** Puts the tab away, lets `seconds` pass, and brings it back. */
function awayFor(seconds: number) {
  act(() => {
    setVisibility("hidden");
  });
  vi.setSystemTime(Date.now() + seconds * 1000);
  act(() => {
    setVisibility("visible");
  });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  setOnline(true);
  setVisibility("visible");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("returning to a screen", () => {
  it("re-reads it after long enough away", () => {
    render(<RefreshOnReturn />);

    awayFor(120);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  /**
   * Switching out to copy an IBAN and straight back is the common case, and it
   * would spend a request redrawing the same pixels.
   */
  it("leaves it alone after a glance at another app", () => {
    render(<RefreshOnReturn />);

    awayFor(5);

    expect(refresh).not.toHaveBeenCalled();
  });

  /** Offline there is nothing fresher to fetch, and the queue has its own trigger. */
  it("does not reach for the network when there is none", () => {
    render(<RefreshOnReturn />);
    setOnline(false);

    awayFor(120);

    expect(refresh).not.toHaveBeenCalled();
  });

  /**
   * The clock restarts on the refresh as well as on leaving, so somebody
   * flicking between two apps gets one re-read rather than one per flick.
   */
  it("counts from the last refresh, not from the first time it was left", () => {
    render(<RefreshOnReturn />);

    awayFor(120);
    expect(refresh).toHaveBeenCalledTimes(1);

    awayFor(5);
    expect(refresh).toHaveBeenCalledTimes(1);

    awayFor(120);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops listening when the shell goes", () => {
    const { unmount } = render(<RefreshOnReturn />);
    unmount();

    awayFor(120);

    expect(refresh).not.toHaveBeenCalled();
  });
});
