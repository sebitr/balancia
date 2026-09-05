import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { passkeys, users } from "@/lib/db/schema";
import { insertUser } from "@/modules/auth/service";
import {
  deletePasskey,
  insertPasskey,
  passkeySignalState,
  startPasskeyRegistration,
  startSignupPasskeyRegistration,
  type VerifiedRegistration,
} from "@/modules/auth/webauthn";

/**
 * The user handle, which is what a password manager groups its list by.
 *
 * Balancia used to have two of them per account without meaning to: a passkey
 * signup filed its credential under a random value it then threw away, and
 * anything added from the settings screen used the account id. That is two
 * entries in the reader's list for one login, and it is also why nothing could
 * address a credential through the Signal API — those calls answer to the
 * handle and nothing else.
 *
 * What cannot be covered here is the repair path, where an assertion's own
 * `userHandle` teaches the database what a pre-existing credential is filed
 * under: that needs a real authenticator signature, not a fixture.
 */

let counter = 0;

/** A verified credential, as the ceremony would have reduced one. */
function credential(
  overrides: Partial<VerifiedRegistration> = {},
): VerifiedRegistration {
  counter += 1;
  return {
    credentialId: `credential-${counter}`,
    publicKey: "cHVibGljLWtleQ",
    counter: 0,
    deviceType: "multiDevice",
    backedUp: true,
    transports: "internal",
    aaguid: null,
    ...overrides,
  };
}

async function anAccount(email = `passkey-${counter}@example.test`) {
  const userId = await insertUser({ email, name: "Ada", passwordHash: null });
  const [row] = await getDb()
    .select({ handle: users.webauthnUserHandle })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { userId, handle: row.handle };
}

describe("the account's handle", () => {
  it("is minted for every account, without a caller thinking about it", async () => {
    const { handle } = await anAccount("minted@example.test");

    // Thirty-two random bytes, base64url: opaque, and not the row id, because
    // this value leaves the server and is kept by a password manager for years.
    expect(handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("differs between accounts", async () => {
    const first = await anAccount("one@example.test");
    const second = await anAccount("two@example.test");

    expect(first.handle).not.toBe(second.handle);
  });

  it("is what a settings registration files the credential under", async () => {
    const { userId, handle } = await anAccount("settings@example.test");

    const options = await startPasskeyRegistration(userId);

    expect(new TextDecoder().decode(base64url(options.user.id))).toBe(handle);
  });

  it("asks for a credential the authenticator can find on its own", async () => {
    // Sign-in sends no `allowCredentials`, so a non-discoverable credential
    // could never be used to sign in — and "preferred" allowed one to be
    // created anyway, which the settings list then showed as a working passkey.
    const { userId } = await anAccount("resident@example.test");

    const options = await startPasskeyRegistration(userId);

    expect(options.authenticatorSelection?.residentKey).toBe("required");
  });

  it("is promised to the authenticator before the account exists", async () => {
    // The signup ceremony has to commit to a handle minutes before there is a
    // row to put it on. The account adopts that promise rather than minting a
    // second one, which is what keeps the first passkey and every later one in
    // a single entry.
    const options = await startSignupPasskeyRegistration({
      email: "signup@example.test",
      name: "Ada",
    });
    const promised = new TextDecoder().decode(base64url(options.user.id));

    const userId = await insertUser({
      email: "signup@example.test",
      name: "Ada",
      passwordHash: null,
      webauthnUserHandle: promised,
    });

    const [row] = await getDb()
      .select({ handle: users.webauthnUserHandle })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    expect(row.handle).toBe(promised);
  });
});

describe("passkeySignalState", () => {
  it("groups an account's credentials under its handle", async () => {
    const { userId, handle } = await anAccount("grouped@example.test");
    await insertPasskey(userId, credential({ credentialId: "a" }), undefined, {
      userHandle: handle,
    });
    await insertPasskey(userId, credential({ credentialId: "b" }), undefined, {
      userHandle: handle,
    });

    const state = await passkeySignalState(userId);

    expect(state?.groups).toEqual([
      { userHandle: handle, credentialIds: ["a", "b"] },
    ]);
  });

  it("speaks for the account's handle even with nothing under it", async () => {
    // The empty list is what clears the entry a password manager keeps after
    // somebody removes their last passkey. Without it the credential is
    // offered forever and fails every time it is chosen.
    const { userId, handle } = await anAccount("empty@example.test");

    const state = await passkeySignalState(userId);

    expect(state?.groups).toEqual([{ userHandle: handle, credentialIds: [] }]);
  });

  it("keeps two handles apart", async () => {
    // An account really can hold two: one from a signup before the handle was
    // recorded, one from every registration since. Merging them into a single
    // call would read as "delete these" to whichever handle lost.
    const { userId, handle } = await anAccount("split@example.test");
    await insertPasskey(
      userId,
      credential({ credentialId: "new" }),
      undefined,
      {
        userHandle: handle,
      },
    );
    await insertPasskey(
      userId,
      credential({ credentialId: "old" }),
      undefined,
      {
        userHandle: "a-handle-from-before",
      },
    );

    const state = await passkeySignalState(userId);

    expect(state?.groups).toContainEqual({
      userHandle: handle,
      credentialIds: ["new"],
    });
    expect(state?.groups).toContainEqual({
      userHandle: "a-handle-from-before",
      credentialIds: ["old"],
    });
  });

  it("says nothing at all while one handle is still unknown", async () => {
    /*
     * The safety rule, and the reason the migration backfills no handles.
     *
     * `signalAllAcceptedCredentials` deletes every credential under a handle
     * that the list it is given leaves out. A row whose handle we do not know
     * cannot be put in any list, so an account holding one cannot be described
     * completely — and an incomplete description would talk a password manager
     * into throwing away a working passkey.
     */
    const { userId, handle } = await anAccount("unknown@example.test");
    await insertPasskey(
      userId,
      credential({ credentialId: "known" }),
      undefined,
      {
        userHandle: handle,
      },
    );
    await getDb()
      .update(passkeys)
      .set({ userHandle: null })
      .where(eq(passkeys.credentialId, "known"));

    const state = await passkeySignalState(userId);

    expect(state?.groups).toEqual([]);
    // The captions are still safe to send: they name nothing to delete.
    expect(state?.name).toBe("unknown@example.test");
  });

  it("carries the address and name a provider captions the entry with", async () => {
    const { userId } = await anAccount("caption@example.test");

    const state = await passkeySignalState(userId);

    expect(state).toMatchObject({
      name: "caption@example.test",
      displayName: "Ada",
    });
  });
});

describe("deletePasskey", () => {
  it("hands back the handle the credential was filed under", async () => {
    // The row is gone by the time this returns, and the handle is the one
    // thing the browser still needs: it is how it asks for the dead entry to
    // be taken out of the reader's password manager.
    const { userId, handle } = await anAccount("removed@example.test");
    const created = await insertPasskey(userId, credential(), undefined, {
      userHandle: handle,
    });

    expect(await deletePasskey(userId, created.id)).toEqual({
      userHandle: handle,
    });
  });

  it("refuses a passkey belonging to somebody else", async () => {
    const mine = await anAccount("mine@example.test");
    const theirs = await anAccount("theirs@example.test");
    const created = await insertPasskey(
      theirs.userId,
      credential(),
      undefined,
      {
        userHandle: theirs.handle,
      },
    );

    await expect(deletePasskey(mine.userId, created.id)).rejects.toThrow();
  });
});

describe("the credential's own record", () => {
  it("keeps the authenticator's model, so the list can name it", async () => {
    const { userId, handle } = await anAccount("aaguid@example.test");
    await insertPasskey(
      userId,
      credential({ aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd" }),
      undefined,
      { userHandle: handle },
    );

    const [row] = await getDb()
      .select({ aaguid: passkeys.aaguid })
      .from(passkeys)
      .where(eq(passkeys.userId, userId));
    expect(row.aaguid).toBe("fbfc3007-154e-4ecc-8c0b-6e020557d7bd");
  });
});

/** base64url → bytes, which is how WebAuthn JSON carries the user handle. */
function base64url(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64url"));
}
