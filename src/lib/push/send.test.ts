import { createECDH, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { generateKeyPair, toBase64Url } from "./keys";
import {
  drawsOwnAttribution,
  resetPushKeys,
  sendPush,
  type PushOutcome,
  type PushTarget,
} from "./send";
import { resetTokenCache } from "./vapid";

/**
 * Which browsers name the app for us.
 *
 * Safari prints the manifest's `short_name` under every push title and offers
 * no way to turn it off, so a title that names the app there names it twice.
 * The only thing a sender has to tell them apart by is the endpoint the
 * browser handed over when it subscribed.
 */
describe("recognising a browser that attributes a push itself", () => {
  it("knows Safari by its push service", () => {
    expect(
      drawsOwnAttribution("https://web.push.apple.com/QDcbQwertyAbc123"),
    ).toBe(true);
  });

  it("does not expect a name from Chrome, Edge or Firefox", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc123:APA91b",
      "https://android.googleapis.com/gcm/send/abc123",
      "https://updates.push.services.mozilla.com/wpush/v2/abc123",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      expect(drawsOwnAttribution(endpoint), endpoint).toBe(false);
    }
  });

  /**
   * The check reads a parsed hostname, not the string, so a host that merely
   * contains Apple's is not mistaken for it.
   */
  it("is not fooled by a host that only looks like Apple's", () => {
    for (const endpoint of [
      "https://web.push.apple.com.example.com/abc",
      "https://notweb.push.apple.com.attacker.test/abc",
      "https://example.com/?x=web.push.apple.com",
    ]) {
      expect(drawsOwnAttribution(endpoint), endpoint).toBe(false);
    }
  });

  /** A subdomain Apple has not used yet is still Apple's. */
  it("accepts another host under Apple's push domain", () => {
    expect(drawsOwnAttribution("https://web2.push.apple.com/abc")).toBe(true);
  });

  /**
   * An unparseable endpoint cannot be pushed to at all, but guessing "names
   * itself" would be the guess that leaves a card unattributed if it could.
   */
  it("assumes nothing is named when the endpoint will not parse", () => {
    expect(drawsOwnAttribution("not a url")).toBe(false);
    expect(drawsOwnAttribution("")).toBe(false);
  });
});

/**
 * An endpoint is whatever a signed-in user subscribed with, so the server at
 * the other end may be theirs — and may answer slowly, never, or with more
 * than anybody should read. The worker sends eight at a time and, on the
 * default stack, runs inside the web process, so one send that is allowed to
 * hang or to fill memory is the whole instance's problem.
 */
describe("sending to an endpoint that will not behave", () => {
  /** The whole schema has to parse, not only the push keys. */
  const ENV = {
    DATABASE_URL: "postgres://balancia:secret@localhost:5432/balancia",
    AUTH_SECRET: "0123456789abcdef0123456789abcdef0123456789",
    PUSH_VAPID_SUBJECT: "mailto:admin@example.test",
  };
  const KEYS = [
    ...Object.keys(ENV),
    "PUSH_VAPID_PUBLIC_KEY",
    "PUSH_VAPID_PRIVATE_KEY",
  ];
  const saved = new Map<string, string | undefined>();

  /** A subscription with real key material, so the encryption step runs. */
  function target(): PushTarget {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    return {
      endpoint: "https://push.example.test/abc",
      p256dh: toBase64Url(ecdh.getPublicKey()),
      auth: toBase64Url(randomBytes(16)),
    };
  }

  beforeEach(() => {
    for (const key of KEYS) saved.set(key, process.env[key]);
    const vapid = generateKeyPair();
    Object.assign(process.env, ENV, {
      PUSH_VAPID_PUBLIC_KEY: vapid.publicKey,
      PUSH_VAPID_PRIVATE_KEY: vapid.privateKey,
    });
    resetEnvCache();
    resetPushKeys();
    resetTokenCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvCache();
    resetPushKeys();
    resetTokenCache();
  });

  /** A fetch that never answers, and gives up only when told to — as fetch does. */
  function silentFetch() {
    return vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
  }

  /**
   * `AbortSignal.timeout` keeps its timer inside Node, where fake timers do
   * not reach. This stands in one on the fake clock that behaves the same
   * way, including the `TimeoutError` it aborts with.
   */
  function timeoutOnTheFakeClock() {
    vi.useFakeTimers();
    return vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(
        () =>
          controller.abort(
            new DOMException("The operation timed out.", "TimeoutError"),
          ),
        ms,
      );
      return controller.signal;
    });
  }

  it("gives up on a server that never answers, and tries again later", async () => {
    const timeout = timeoutOnTheFakeClock();
    const fetchMock = silentFetch();
    vi.stubGlobal("fetch", fetchMock);

    let outcome: PushOutcome | undefined;
    void sendPush(target(), "{}").then((result) => (outcome = result));

    await vi.advanceTimersByTimeAsync(9_999);
    expect(outcome).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({
      status: "retry",
      reason: "Push service did not answer within 10 seconds.",
    });
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /** A caller that wants to stop sooner still can; the deadline is a ceiling. */
  it("still stops when the caller does", async () => {
    timeoutOnTheFakeClock();
    vi.stubGlobal("fetch", silentFetch());
    const caller = new AbortController();

    let outcome: PushOutcome | undefined;
    void sendPush(target(), "{}", { signal: caller.signal }).then(
      (result) => (outcome = result),
    );
    caller.abort(new Error("Shutting down"));
    await vi.advanceTimersByTimeAsync(0);

    expect(outcome).toEqual({ status: "retry", reason: "Shutting down" });
  });

  /**
   * A 400 comes with a sentence of explanation from a real push service, and
   * with whatever the owner of the endpoint likes from anybody else's. This
   * one never ends: `response.text()` would sit buffering it until the
   * process ran out of memory.
   */
  it("reads only the start of a rejection that never ends", async () => {
    const body = { pulls: 0, cancelled: false };
    const chunk = new TextEncoder().encode("junk ".repeat(1_000));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        body.pulls += 1;
        // A safety valve for the test runner, not part of the scenario: an
        // unbounded read stops here, having taken 5 MB, and fails the
        // assertions below instead of taking the worker down with it.
        if (body.pulls > 1_000) controller.close();
        else controller.enqueue(chunk);
      },
      cancel() {
        body.cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream, { status: 400 })),
    );

    const outcome = await sendPush(target(), "{}");

    expect(outcome).toEqual({
      status: "failed",
      reason: `Push service returned 400: ${"junk ".repeat(40)}.`,
    });
    expect(body.cancelled).toBe(true);
    expect(body.pulls).toBeLessThan(5);
  });
});
