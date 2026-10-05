import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { SignOutButton } from "./sign-out-button";
import { DangerCard } from "./danger-card";

/**
 * Signing out of a device somebody else may pick up next.
 *
 * Two things are pinned here. What the sheet says before the tap: entries that
 * have not reached the server yet exist only on this device, and signing out
 * deletes them, so the count is spelled out while "Keep it" is still there to
 * press. And what the tap does, in order: the device forgets first, then push
 * is turned off for this browser while there is still a session to do it
 * with, then the session ends with the header that clears the browser's cache,
 * then the action that redirects.
 *
 * The push step runs for real against a stand-in service worker, so these
 * pin what reaches the server — this browser's endpoint — and not only that a
 * function was called.
 */

const { countQueued, forgetDevice, signOutAction, deleteAccountAction } =
  vi.hoisted(() => ({
    countQueued: vi.fn<() => Promise<number>>(),
    forgetDevice: vi.fn<() => Promise<void>>(),
    signOutAction: vi.fn<() => Promise<void>>(),
    deleteAccountAction: vi.fn(),
  }));

vi.mock("@/lib/offline/outbox", () => ({
  countQueued: () => countQueued(),
  subscribeToOutbox: () => () => {},
}));
vi.mock("@/lib/offline/forget", () => ({
  forgetDevice: () => forgetDevice(),
}));
vi.mock("@/modules/auth/actions", () => ({
  signOutAction: () => signOutAction(),
  deleteAccountAction: (input: unknown) => deleteAccountAction(input),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const steps: string[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;

const ENDPOINT = "https://push.example.test/send/abc123";

/**
 * What `navigator.serviceWorker` answers. jsdom has none, so it is defined
 * on the real navigator for each test and taken away after.
 */
function serviceWorker(value: unknown) {
  Object.defineProperty(window.navigator, "serviceWorker", {
    value,
    configurable: true,
  });
}

/** A browser that has push turned on for whoever is signed in. */
function subscribedBrowser() {
  unsubscribe = vi.fn(async () => {
    steps.push("unsubscribe");
    return true;
  });
  serviceWorker({
    getRegistration: async () => ({
      pushManager: {
        getSubscription: async () => ({ endpoint: ENDPOINT, unsubscribe }),
      },
    }),
  });
}

beforeEach(() => {
  steps.length = 0;
  subscribedBrowser();
  countQueued.mockReset().mockResolvedValue(0);
  forgetDevice.mockReset().mockImplementation(async () => {
    steps.push("forget");
  });
  signOutAction.mockReset().mockImplementation(async () => {
    steps.push("action");
  });
  deleteAccountAction.mockReset();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    steps.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, "serviceWorker");
});

async function openSheet() {
  const user = userEvent.setup();
  renderWithIntl(<SignOutButton />);
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  const dialog = await screen.findByRole("alertdialog");
  return { user, dialog };
}

describe("SignOutButton", () => {
  it("asks plainly when nothing is waiting to be sent", async () => {
    await openSheet();

    await waitFor(() => expect(countQueued).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says how many entries signing out would delete", async () => {
    countQueued.mockResolvedValue(2);
    await openSheet();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "2 entries on this device have not synced yet, and signing out deletes them.",
    );
  });

  it("names one entry as one", async () => {
    countQueued.mockResolvedValue(1);
    await openSheet();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "1 entry on this device has not synced yet, and signing out deletes it.",
    );
  });

  it("leaves everything in place for somebody who stays signed in", async () => {
    countQueued.mockResolvedValue(2);
    const { user } = await openSheet();
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Keep it" }));

    expect(forgetDevice).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(signOutAction).not.toHaveBeenCalled();
  });

  it("clears the device, stops push, ends the session, then redirects", async () => {
    const { user } = await openSheet();

    await user.click(
      screen.getAllByRole("button", { name: "Sign out" }).at(-1)!,
    );

    await waitFor(() =>
      expect(steps).toEqual([
        "forget",
        // While the session still exists: the server's record of this device
        // is removed as the account that owns it.
        "DELETE /api/push/subscriptions",
        "unsubscribe",
        "DELETE /api/auth/session",
        "action",
      ]),
    );
    const pushRequest = fetchMock.mock.calls.find(
      ([url]) => url === "/api/push/subscriptions",
    )!;
    expect(JSON.parse((pushRequest[1] as RequestInit).body as string)).toEqual({
      endpoint: ENDPOINT,
    });
  });

  it("still signs out when the session request never came back", async () => {
    // The action ends the session on its own; the request before it is there
    // for the header, and losing that is no reason to stay signed in.
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { user } = await openSheet();

    await user.click(
      screen.getAllByRole("button", { name: "Sign out" }).at(-1)!,
    );

    await waitFor(() => expect(signOutAction).toHaveBeenCalledOnce());
    expect(forgetDevice).toHaveBeenCalledOnce();
    // The browser let go of push all the same.
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("still signs out when the browser will not let go of push", async () => {
    unsubscribe.mockRejectedValue(new Error("InvalidStateError"));
    const { user } = await openSheet();

    await user.click(
      screen.getAllByRole("button", { name: "Sign out" }).at(-1)!,
    );

    await waitFor(() => expect(signOutAction).toHaveBeenCalledOnce());
  });

  it("signs out without a push step on a browser with no service worker", async () => {
    // A development server or plain HTTP: no worker was ever registered, so
    // there is no subscription to remove — and nothing to wait on.
    serviceWorker({ getRegistration: async () => undefined });
    const { user } = await openSheet();

    await user.click(
      screen.getAllByRole("button", { name: "Sign out" }).at(-1)!,
    );

    await waitFor(() =>
      expect(steps).toEqual(["forget", "DELETE /api/auth/session", "action"]),
    );
  });
});

describe("DangerCard", () => {
  it("gives the Account screen's sign-out the same warning", async () => {
    countQueued.mockResolvedValue(3);
    const user = userEvent.setup();
    renderWithIntl(<DangerCard email="ada@example.com" />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "3 entries on this device have not synced yet",
    );
  });

  it("clears the device and stops push once the account is gone", async () => {
    deleteAccountAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderWithIntl(<DangerCard email="ada@example.com" />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.type(
      screen.getByLabelText("Type your email address to confirm"),
      "ada@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    // The account's push rows went with it; the server's half answers with
    // nothing to do, and the browser's half is what kills the endpoint.
    await waitFor(() =>
      expect(steps).toEqual([
        "forget",
        "DELETE /api/push/subscriptions",
        "unsubscribe",
        "DELETE /api/auth/session",
      ]),
    );
  });

  it("clears nothing when the account could not be deleted", async () => {
    deleteAccountAction.mockResolvedValue({ ok: false, error: "No." });
    const user = userEvent.setup();
    renderWithIntl(<DangerCard email="ada@example.com" />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.type(
      screen.getByLabelText("Type your email address to confirm"),
      "ada@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteAccountAction).toHaveBeenCalledOnce());
    expect(forgetDevice).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
