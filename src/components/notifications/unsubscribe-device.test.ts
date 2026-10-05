import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unsubscribeThisDevice } from "./unsubscribe-device";

/**
 * Push, turned off for the browser somebody is signing out of.
 *
 * The service worker and the Push API are stood in for: Node has neither.
 * What is pinned is the order — the server is told the endpoint while there is
 * still a session to tell it with, and then the browser lets go of it — and
 * that no failure along the way escapes into the sign-out that called it.
 */

const ENDPOINT = "https://push.example.test/send/abc123";

const steps: string[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;

/** A browser with a worker, and optionally a subscription on it. */
function browserWith(subscribed: boolean) {
  unsubscribe = vi.fn(async () => {
    steps.push("unsubscribe");
    return true;
  });
  const subscription = subscribed ? { endpoint: ENDPOINT, unsubscribe } : null;
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: async () => ({
        pushManager: { getSubscription: async () => subscription },
      }),
    },
  });
}

beforeEach(() => {
  steps.length = 0;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    steps.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("unsubscribeThisDevice", () => {
  it("has the server forget this endpoint, then unsubscribes the browser", async () => {
    browserWith(true);

    await unsubscribeThisDevice();

    expect(steps).toEqual(["DELETE /api/push/subscriptions", "unsubscribe"]);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ endpoint: ENDPOINT });
  });

  it("does nothing on a browser that was never subscribed", async () => {
    browserWith(false);

    await unsubscribeThisDevice();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still unsubscribes when the server could not be told", async () => {
    // The browser's half is the one that stops the notifications: a dead
    // endpoint is answered 404 on the next send, and the row goes then.
    browserWith(true);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(unsubscribeThisDevice()).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("still unsubscribes when the server refused", async () => {
    browserWith(true);
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    await unsubscribeThisDevice();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("never throws, whatever the browser does", async () => {
    browserWith(true);
    unsubscribe.mockRejectedValue(new Error("InvalidStateError"));
    await expect(unsubscribeThisDevice()).resolves.toBeUndefined();

    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: async () => {
          throw new Error("SecurityError");
        },
      },
    });
    await expect(unsubscribeThisDevice()).resolves.toBeUndefined();
  });

  it("does not wait on a worker that is not there", async () => {
    // No registration at all — a development server, plain HTTP. Waiting on
    // `serviceWorker.ready` here would hang sign-out for good.
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => undefined },
    });
    await expect(unsubscribeThisDevice()).resolves.toBeUndefined();

    // And no service worker API at all.
    vi.stubGlobal("navigator", {});
    await expect(unsubscribeThisDevice()).resolves.toBeUndefined();

    // Nor a Push API on the registration: Safari before it is installed.
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => ({}) },
    });
    await expect(unsubscribeThisDevice()).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
