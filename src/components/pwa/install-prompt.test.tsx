import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl as render } from "../../../tests/helpers/intl";
import {
  USER_AGENTS,
  fireBeforeInstallPrompt,
  restoreDisplayMode,
  setUserAgent,
  stubStandalone,
} from "../../../tests/helpers/pwa";
import { InstallPrompt } from "./install-prompt";
import { resetInstallPromptForTests } from "./use-install-prompt";

/**
 * The contextual suggestion.
 *
 * The dashboard decides *when* this renders — only on the branch where the
 * visitor already belongs to a group — so what is left to pin down here is
 * *whether*: which platforms it offers itself to, and that a refusal sticks.
 */
describe("InstallPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
    setUserAgent(USER_AGENTS.androidChrome);
    // Installability is module state by design — the event fires once, before
    // anything mounts — so each case has to start from a clean store.
    resetInstallPromptForTests();
  });

  afterEach(restoreDisplayMode);

  it("offers nothing until the browser says the app is installable", () => {
    render(<InstallPrompt />);

    expect(screen.queryByText("Install Balancia")).toBeNull();
  });

  it("invites the user once Chromium hands over the install event", () => {
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();

    expect(screen.getByText("Install Balancia")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("opens the real install sheet rather than instructions on Chromium", async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    const event = fireBeforeInstallPrompt();

    await user.click(screen.getByRole("button", { name: "Install" }));

    expect(event.prompt).toHaveBeenCalledOnce();
    // The event is single-use, so the invitation stands down afterwards.
    await waitFor(() =>
      expect(screen.queryByText("Install Balancia")).toBeNull(),
    );
  });

  it("treats declining the native sheet as a no and stops asking", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<InstallPrompt />);
    fireBeforeInstallPrompt("dismissed");

    await user.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() =>
      expect(localStorage.getItem("balancia:install-dismissed")).toBe("1"),
    );

    unmount();
    resetInstallPromptForTests();
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    expect(screen.queryByText("Install Balancia")).toBeNull();
  });

  it("stays quiet for good once waved away", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<InstallPrompt />);
    fireBeforeInstallPrompt();

    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Install Balancia")).toBeNull();

    // A later visit must not bring it back. Resetting the module store is what
    // makes this a real test of the persisted flag rather than of memory.
    unmount();
    resetInstallPromptForTests();
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    expect(screen.queryByText("Install Balancia")).toBeNull();
  });

  it("offers itself on iOS Safari, which never fires an install event", () => {
    setUserAgent(USER_AGENTS.iosSafari);
    resetInstallPromptForTests();

    render(<InstallPrompt />);

    expect(screen.getByText("Install Balancia")).toBeInTheDocument();
  });

  it("says nothing on a browser with no route to installation at all", () => {
    setUserAgent(USER_AGENTS.androidFirefox);
    resetInstallPromptForTests();

    render(<InstallPrompt />);

    expect(screen.queryByText("Install Balancia")).toBeNull();
  });

  it("says nothing when it is already running as an installed app", () => {
    stubStandalone();
    setUserAgent(USER_AGENTS.iosSafari);
    resetInstallPromptForTests();

    render(<InstallPrompt />);

    expect(screen.queryByText("Install Balancia")).toBeNull();
  });
});
