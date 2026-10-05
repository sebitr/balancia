import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePushSubscription } from "./use-push-subscription";
import { unsubscribeThisDevice } from "./unsubscribe-device";

/**
 * Whether push reads as on, for the next person to sign in on a device.
 *
 * The switch on the notifications screen reads the browser's own subscription
 * every time it mounts, never a flag kept anywhere — which is what makes a
 * sign-out that unsubscribed the browser show up as "off" for whoever signs
 * in next, without that person's account knowing anything about the last one.
 */

let current: { endpoint: string; unsubscribe: () => Promise<boolean> } | null;

function define(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, configurable: true });
}

beforeEach(() => {
  current = {
    endpoint: "https://push.example.test/send/abc123",
    unsubscribe: async () => {
      current = null;
      return true;
    },
  };
  define(window, "PushManager", class {});
  define(window, "Notification", { permission: "granted" });
  define(window.navigator, "serviceWorker", {
    getRegistration: async () => ({
      pushManager: { getSubscription: async () => current },
    }),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/api/push/key"
        ? Response.json({ publicKey: "BPublicKey" })
        : Response.json({ ok: true }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "PushManager");
  Reflect.deleteProperty(window, "Notification");
  Reflect.deleteProperty(window.navigator, "serviceWorker");
});

describe("usePushSubscription", () => {
  it("reads push as on while this browser holds a subscription", async () => {
    const { result } = renderHook(() => usePushSubscription());

    await waitFor(() => expect(result.current.status).toBe("on"));
  });

  it("reads it as off after a sign-out unsubscribed this browser", async () => {
    await unsubscribeThisDevice();

    // The next person signs in and opens the screen: a fresh mount, reading
    // the browser again. The permission is still granted, so it is a switch
    // they can turn on for themselves rather than a blocked one.
    const { result } = renderHook(() => usePushSubscription());

    await waitFor(() => expect(result.current.status).toBe("off"));
  });
});
