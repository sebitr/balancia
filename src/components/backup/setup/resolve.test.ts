import { describe, expect, it } from "vitest";
import { resolveSetup, type Resolution, type SetupFacts } from "./resolve";

/**
 * Which step an address may land on.
 *
 * The page asks this before it draws anything, and the answers are all about
 * what a bookmark, a reload or a hand-typed address is allowed to do: skip a
 * key that is already saved, reach step 3 without having chosen anywhere, or
 * stand on step 4 with nothing connected to finish.
 */

const TILES = [
  { id: "google_drive", availability: "available" },
  { id: "dropbox", availability: "experimental_off" },
  { id: "s3", availability: "available" },
  { id: "webdav", availability: "available" },
  { id: "proton_drive", availability: "experimental_off" },
] as const;

const DESTINATION = {
  id: "d1",
  provider: "dropbox",
  frequency: "weekly",
  keepLast: 20,
  excludedGroupIds: ["g2"],
  includeReceipts: true,
} as const;

const PENDING = {
  id: "p1",
  provider: "google_drive",
  label: "Google Drive · ada@example.com",
} as const;

function facts(overrides: Partial<SetupFacts> = {}): SetupFacts {
  return {
    hasKey: true,
    destinations: [],
    pending: null,
    providers: TILES,
    ...overrides,
  };
}

function ok(resolution: Resolution) {
  if (resolution.kind !== "ok") {
    throw new Error(`Expected a screen, got ${resolution.kind}`);
  }
  return resolution;
}

describe("the step an address lands on", () => {
  it("starts at the key when there is none, and at 'where' when there is", () => {
    expect(ok(resolveSetup(facts({ hasKey: false }), {})).state.step).toBe(
      "key",
    );
    expect(ok(resolveSetup(facts(), {})).state.step).toBe("where");
  });

  it("makes the key first even when asked for a later step", () => {
    const resolved = ok(
      resolveSetup(facts({ hasKey: false }), {
        step: "what",
        provider: "s3",
      }),
    );
    expect(resolved.state.step).toBe("key");
  });

  it("does not make a second key unless a new one was asked for", () => {
    expect(ok(resolveSetup(facts(), { step: "key" })).state.step).toBe("where");

    const rotating = ok(
      resolveSetup(facts({ destinations: [DESTINATION] }), {
        step: "where",
        rotate: "1",
      }),
    );
    expect(rotating.state).toMatchObject({ step: "key", rotate: true });
  });

  it("ignores a request for a new key when there is no key to replace", () => {
    const resolved = ok(
      resolveSetup(facts({ hasKey: false }), { rotate: "1" }),
    );
    expect(resolved.state.rotate).toBe(false);
  });

  it("sends step 3 and 4 back to 'where' while nothing is chosen", () => {
    expect(ok(resolveSetup(facts(), { step: "connect" })).state.step).toBe(
      "where",
    );
    expect(
      ok(resolveSetup(facts(), { step: "what", provider: "nonsense" })).state
        .step,
    ).toBe("where");
  });

  it("does not take a provider this server has not switched on", () => {
    const resolved = ok(
      resolveSetup(facts(), { step: "connect", provider: "dropbox" }),
    );
    expect(resolved.state).toMatchObject({ step: "where", provider: null });

    const proton = ok(
      resolveSetup(facts(), { step: "connect", provider: "proton_drive" }),
    );
    expect(proton.state.provider).toBeNull();
  });

  it("takes Infomaniak when both of the services behind it are there", () => {
    const resolved = ok(
      resolveSetup(facts(), { step: "connect", provider: "infomaniak" }),
    );
    expect(resolved.state).toMatchObject({
      step: "connect",
      provider: "infomaniak",
    });

    const withoutS3 = ok(
      resolveSetup(
        facts({ providers: TILES.filter((tile) => tile.id !== "s3") }),
        { step: "connect", provider: "infomaniak" },
      ),
    );
    expect(withoutS3.state.provider).toBeNull();
  });

  it("lets a typed connection reach step 4, which only the browser can vouch for", () => {
    const resolved = ok(
      resolveSetup(facts(), { step: "what", provider: "s3" }),
    );
    expect(resolved.state.step).toBe("what");
  });

  it("holds an account connection to the connection that came back", () => {
    const without = ok(
      resolveSetup(facts({ pending: PENDING }), {
        step: "what",
        provider: "google_drive",
      }),
    );
    expect(without.state.step).toBe("connect");

    const wrongId = ok(
      resolveSetup(facts({ pending: PENDING }), {
        step: "what",
        provider: "google_drive",
        connected: "somebody-elses",
      }),
    );
    expect(wrongId.state).toMatchObject({ step: "connect", connected: false });

    const right = ok(
      resolveSetup(facts({ pending: PENDING }), {
        step: "what",
        provider: "google_drive",
        connected: "p1",
      }),
    );
    expect(right.state).toMatchObject({ step: "what", connected: true });
  });

  it("does not count a connection made for another provider", () => {
    const resolved = ok(
      resolveSetup(facts({ pending: PENDING }), {
        step: "connect",
        provider: "s3",
        connected: "p1",
      }),
    );
    expect(resolved.state.connected).toBe(false);
  });

  it("passes on only the words an OAuth return can say", () => {
    const say = (connect: string) =>
      ok(resolveSetup(facts(), { step: "where", connect })).state
        .connectOutcome;

    expect(say("denied")).toBe("denied");
    expect(say("quota")).toBe("quota");
    expect(say("<script>")).toBeNull();
  });
});

describe("somebody who already has a destination", () => {
  const has = facts({ destinations: [DESTINATION] });

  it("goes to the overview unless they came to change something", () => {
    expect(resolveSetup(has, {})).toEqual({
      kind: "redirect",
      to: "/settings/backup",
    });
    expect(resolveSetup(has, { step: "connect", provider: "s3" }).kind).toBe(
      "redirect",
    );
  });

  it("may change where to back up, starting from what they have now", () => {
    const resolved = ok(resolveSetup(has, { step: "where", replace: "d1" }));
    expect(resolved.state.replace).toEqual({
      id: "d1",
      provider: "dropbox",
      frequency: "weekly",
      keepLast: 20,
      excludedGroupIds: ["g2"],
      includeReceipts: true,
    });
  });

  it("is told there is no such destination when it is not theirs", () => {
    expect(resolveSetup(has, { replace: "d2" })).toEqual({ kind: "notFound" });
  });

  it("may make a new key", () => {
    expect(ok(resolveSetup(has, { rotate: "1" })).state.rotate).toBe(true);
  });

  it("is changing where to back up when a connection comes back from a trip", () => {
    // The provider does not send `replace` back, and there is no way to add a
    // second destination from these screens, so this can only be a change.
    const resolved = ok(
      resolveSetup(facts({ destinations: [DESTINATION], pending: PENDING }), {
        step: "connect",
        provider: "google_drive",
        connected: "p1",
      }),
    );
    expect(resolved.state.replace?.id).toBe("d1");
    expect(resolved.state.connected).toBe(true);
  });

  it("does not take a connection that is not theirs as a reason to stay", () => {
    expect(
      resolveSetup(facts({ destinations: [DESTINATION], pending: PENDING }), {
        step: "connect",
        provider: "google_drive",
        connected: "somebody-elses",
      }).kind,
    ).toBe("redirect");
  });
});

describe("the screen's own back arrow", () => {
  it("leaves the wizard from the first step", () => {
    expect(ok(resolveSetup(facts({ hasKey: false }), {})).backHref).toBe(
      "/settings/backup",
    );
    expect(ok(resolveSetup(facts(), {})).backHref).toBe("/settings/backup");
  });

  it("goes back one step, keeping the provider and the connection", () => {
    const resolved = ok(
      resolveSetup(facts({ pending: PENDING }), {
        step: "what",
        provider: "google_drive",
        connected: "p1",
      }),
    );
    expect(resolved.backHref).toBe(
      "/settings/backup/setup?step=connect&provider=google_drive&connected=p1",
    );

    const fromConnect = ok(
      resolveSetup(facts(), { step: "connect", provider: "s3" }),
    );
    expect(fromConnect.backHref).toBe(
      "/settings/backup/setup?step=where&provider=s3",
    );
  });

  it("goes to the overview from a new key", () => {
    const resolved = ok(
      resolveSetup(facts({ destinations: [DESTINATION] }), { rotate: "1" }),
    );
    expect(resolved.backHref).toBe("/settings/backup");
  });
});
