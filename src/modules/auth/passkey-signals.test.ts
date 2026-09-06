// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetUnknownPasskey,
  reconcilePasskeyList,
  updatePasskeyUserDetails,
  type PasskeySignalState,
} from "./passkey-signals";

/**
 * The Signal API wrapper, and mostly the two ways it is allowed to say nothing.
 *
 * `signalAllAcceptedCredentials` deletes: anything stored under a handle that
 * the list omits is removed from the reader's password manager, and a passkey
 * does not come back. So the interesting cases here are not the happy path but
 * the silences — a browser that does not have the call, and a server that
 * declined to describe the account because it could not describe it fully.
 */

interface Calls {
  accepted: unknown[];
  unknown: unknown[];
  details: unknown[];
}

function install(
  which: Partial<Record<"accepted" | "unknown" | "details", boolean>> = {
    accepted: true,
    unknown: true,
    details: true,
  },
): Calls {
  const calls: Calls = { accepted: [], unknown: [], details: [] };
  const api: Record<string, unknown> = {};
  if (which.accepted) {
    api.signalAllAcceptedCredentials = (options: unknown) => {
      calls.accepted.push(options);
      return Promise.resolve();
    };
  }
  if (which.unknown) {
    api.signalUnknownCredential = (options: unknown) => {
      calls.unknown.push(options);
      return Promise.resolve();
    };
  }
  if (which.details) {
    api.signalCurrentUserDetails = (options: unknown) => {
      calls.details.push(options);
      return Promise.resolve();
    };
  }
  vi.stubGlobal("PublicKeyCredential", api);
  return calls;
}

const state = (groups: PasskeySignalState["groups"]): PasskeySignalState => ({
  name: "ada@balancia.local",
  displayName: "Ada",
  groups,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reconcilePasskeyList", () => {
  it("speaks once per handle, with that handle's credentials", () => {
    // Plural because an account really can hold two: one from a passkey signup
    // before the handle was recorded, one from every later registration. They
    // are separate entries in the reader's list and cannot be merged into one
    // call — the credentials of the second would read as "delete these" to the
    // first.
    const calls = install();

    reconcilePasskeyList(
      "balancia.app",
      state([
        { userHandle: "abc", credentialIds: ["one", "two"] },
        { userHandle: "def", credentialIds: ["three"] },
      ]),
    );

    expect(calls.accepted).toEqual([
      {
        rpId: "balancia.app",
        userId: "YWJj",
        allAcceptedCredentialIds: ["one", "two"],
      },
      {
        rpId: "balancia.app",
        userId: "ZGVm",
        allAcceptedCredentialIds: ["three"],
      },
    ]);
  });

  it("clears a handle with nothing left under it", () => {
    // What somebody who just removed their last passkey needs: an empty list
    // is the only thing that takes the dead entry out of their password
    // manager, and it is exactly the call that would be a catastrophe if the
    // server had guessed at the account rather than known it.
    const calls = install();

    reconcilePasskeyList(
      "balancia.app",
      state([{ userHandle: "abc", credentialIds: [] }]),
    );

    expect(calls.accepted).toEqual([
      { rpId: "balancia.app", userId: "YWJj", allAcceptedCredentialIds: [] },
    ]);
  });

  it("says nothing when the server declined to describe the account", () => {
    // No groups means "one of this account's credentials has an unknown
    // handle, so the picture is incomplete". Speaking anyway would hand a
    // short list to a call that deletes what the list leaves out.
    const calls = install();

    reconcilePasskeyList("balancia.app", state([]));

    expect(calls.accepted).toEqual([]);
  });

  it("says nothing in a browser without the call", () => {
    const calls = install({ unknown: true, details: true });

    reconcilePasskeyList(
      "balancia.app",
      state([{ userHandle: "abc", credentialIds: ["one"] }]),
    );

    expect(calls.accepted).toEqual([]);
  });

  it("survives a password manager that refuses", () => {
    vi.stubGlobal("PublicKeyCredential", {
      signalAllAcceptedCredentials: () => Promise.reject(new Error("nope")),
    });

    expect(() =>
      reconcilePasskeyList(
        "balancia.app",
        state([{ userHandle: "abc", credentialIds: [] }]),
      ),
    ).not.toThrow();
  });
});

describe("forgetUnknownPasskey", () => {
  it("names the credential outright, with no handle to know", () => {
    // Which is what makes it the only call that can help an account whose
    // handles are all still unknown — and why a failed sign-in is worth acting
    // on rather than only reporting.
    const calls = install();

    forgetUnknownPasskey("balancia.app", "credential-id");

    expect(calls.unknown).toEqual([
      { rpId: "balancia.app", credentialId: "credential-id" },
    ]);
  });

  it("says nothing in a browser without the call", () => {
    const calls = install({ accepted: true, details: true });

    forgetUnknownPasskey("balancia.app", "credential-id");

    expect(calls.unknown).toEqual([]);
  });
});

describe("updatePasskeyUserDetails", () => {
  it("re-captions every handle with the account's current name", () => {
    const calls = install();

    updatePasskeyUserDetails(
      "balancia.app",
      state([{ userHandle: "abc", credentialIds: ["one"] }]),
    );

    expect(calls.details).toEqual([
      {
        rpId: "balancia.app",
        userId: "YWJj",
        name: "ada@balancia.local",
        displayName: "Ada",
      },
    ]);
  });

  it("says nothing in a browser without the call", () => {
    const calls = install({ accepted: true, unknown: true });

    updatePasskeyUserDetails(
      "balancia.app",
      state([{ userHandle: "abc", credentialIds: ["one"] }]),
    );

    expect(calls.details).toEqual([]);
  });
});
