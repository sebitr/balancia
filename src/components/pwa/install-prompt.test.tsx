import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl as render } from "../../../tests/helpers/intl";
import { InstallPrompt } from "./install-prompt";
import { resetInstallPromptForTests } from "./use-install-prompt";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

function setUserAgent(value: string): void {
  Object.defineProperty(window.navigator, "userAgent", {
    value,
    configurable: true,
  });
}

/** Stands in for the Chromium event, which jsdom has no notion of. */
function fireBeforeInstallPrompt(
  outcome: "accepted" | "dismissed" = "accepted",
) {
  const event = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

/** Reports the app as already installed, the way a standalone window would. */
function pretendInstalled(): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("standalone"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const realMatchMedia = window.matchMedia;

describe("InstallPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
    setUserAgent(ANDROID_UA);
    // Installability is module state by design — the event fires once, before
    // anything mounts — so each case has to start from a clean store.
    resetInstallPromptForTests();
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it("offers nothing until the browser says the app is installable", () => {
    render(<InstallPrompt />);

    expect(screen.queryByText(/add balancia to your home screen/i)).toBeNull();
  });

  it("invites the user once Chromium hands over the install event", () => {
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();

    expect(
      screen.getByText("Add Balancia to your home screen"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add to home screen" }),
    ).toBeInTheDocument();
  });

  it("opens the real install sheet rather than instructions on Chromium", async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    const event = fireBeforeInstallPrompt();

    await user.click(
      screen.getByRole("button", { name: "Add to home screen" }),
    );

    expect(event.prompt).toHaveBeenCalledOnce();
    // The event is single-use, so the invitation stands down afterwards.
    expect(screen.queryByText("Add Balancia to your home screen")).toBeNull();
  });

  it("stays quiet for good once dismissed", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<InstallPrompt />);
    fireBeforeInstallPrompt();

    await user.click(
      screen.getByRole("button", { name: "Dismiss install invitation" }),
    );
    expect(screen.queryByText("Add Balancia to your home screen")).toBeNull();

    // A later visit must not bring it back. Resetting the module store is what
    // makes this a real test of the persisted flag rather than of memory.
    unmount();
    resetInstallPromptForTests();
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    expect(screen.queryByText("Add Balancia to your home screen")).toBeNull();
  });

  it("falls back to share-sheet instructions on iOS, which has no install API", async () => {
    const user = userEvent.setup();
    setUserAgent(IPHONE_UA);
    render(<InstallPrompt />);

    // No beforeinstallprompt is ever fired on iOS; the invitation still shows.
    await user.click(screen.getByRole("button", { name: "Show me how" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Share");
    expect(dialog).toHaveTextContent("Add to Home Screen");
  });

  it("says nothing when it is already running as an installed app", () => {
    pretendInstalled();
    setUserAgent(IPHONE_UA);

    render(<InstallPrompt />);

    expect(screen.queryByText(/add balancia to your home screen/i)).toBeNull();
  });
});
