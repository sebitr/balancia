import "server-only";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getDb, rowsAffected, type Database } from "@/lib/db/client";
import { passkeys, users, webauthnChallenges } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { telemetry } from "@/lib/telemetry";
import { isUniqueViolation } from "@/lib/db/errors";
import { provisionalNameFor } from "@/modules/profile/provisional-name";
import { storableAaguid } from "./passkey-providers";
import { mintWebauthnUserHandle } from "./user-handle";
import { AuthError } from "./service";

/**
 * Passkey (WebAuthn) registration and authentication.
 *
 * The protocol work — CBOR decoding, COSE key parsing, attestation and
 * signature verification — is delegated to @simplewebauthn/server rather than
 * reimplemented. Getting that wrong is a security bug, not a style choice.
 *
 * What Balancia owns is the surrounding state machine, and its rules are:
 *
 *  - Challenges are generated server-side, stored, single-use, and expire in
 *    five minutes. A challenge the server did not issue is never accepted.
 *  - The expected origin and relying-party ID come from validated environment
 *    configuration, so a credential registered for one deployment cannot be
 *    replayed against another.
 *  - The signature counter is checked and advanced; a counter that fails to
 *    increase suggests a cloned authenticator and is refused.
 *  - Every ceremony for an existing account files the credential under that
 *    account's one stable user handle, because the handle is what a password
 *    manager groups its list by. Two handles on one account means two entries
 *    in the reader's list for one Balancia login.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function relyingParty(): { rpID: string; origin: string; rpName: string } {
  const env = getEnv();
  return {
    rpID: env.webAuthnRpId,
    origin: env.appOrigin,
    rpName: env.WEBAUTHN_RP_NAME,
  };
}

/**
 * The three ceremonies, which differ in who they are for.
 *
 * `registration` and `authentication` both belong to an account that already
 * exists. `signup` is the one that does not: it carries the identity an
 * account *would* be created with, and creates nothing until an authenticator
 * has answered.
 */
type ChallengeKind = "registration" | "authentication" | "signup";

/** The identity a signup ceremony is holding on behalf of a future account. */
interface PendingSignup {
  readonly email: string;
  /** Null when the ceremony was started before anything asked for a name. */
  readonly name: string | null;
  readonly userHandle: string;
}

async function storeChallenge(
  challenge: string,
  kind: ChallengeKind,
  userId: string | null,
  options: { db?: Database; signup?: PendingSignup } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db.insert(webauthnChallenges).values({
    userId,
    challenge,
    kind,
    signupEmail: options.signup?.email ?? null,
    signupName: options.signup?.name ?? null,
    userHandle: options.signup?.userHandle ?? null,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
}

/**
 * Consumes a challenge, returning the user it was issued for.
 *
 * The update-and-return makes consumption atomic: two concurrent submissions
 * of the same challenge cannot both succeed.
 */
async function consumeChallenge(
  challenge: string,
  kind: ChallengeKind,
  options: { db?: Database } = {},
): Promise<{
  userId: string | null;
  signup: PendingSignup | null;
} | null> {
  const db = options.db ?? getDb();
  const [row] = await db
    .update(webauthnChallenges)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(webauthnChallenges.challenge, challenge),
        eq(webauthnChallenges.kind, kind),
        isNull(webauthnChallenges.consumedAt),
        gt(webauthnChallenges.expiresAt, new Date()),
      ),
    )
    .returning({
      userId: webauthnChallenges.userId,
      signupEmail: webauthnChallenges.signupEmail,
      signupName: webauthnChallenges.signupName,
      userHandle: webauthnChallenges.userHandle,
    });

  if (!row) return null;
  return {
    userId: row.userId,
    // The column check keeps the address and the handle either both present
    // or both absent, so one test stands for the pair. The name is not part
    // of it: a signup that was never told one carries null here and creates
    // an account the dashboard asks about.
    signup:
      row.signupEmail && row.userHandle
        ? {
            email: row.signupEmail,
            name: row.signupName,
            userHandle: row.userHandle,
          }
        : null,
  };
}

/** Options for registering a new passkey on the signed-in user's account. */
export async function startPasskeyRegistration(
  userId: string,
  options: { db?: Database } = {},
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const db = options.db ?? getDb();
  const { rpID, rpName } = relyingParty();

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      userHandle: users.webauthnUserHandle,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    throw new AuthError(
      "Sign in again to register a passkey.",
      "passkeySignInAgain",
    );
  }

  const existing = await db
    .select({
      credentialId: passkeys.credentialId,
      transports: passkeys.transports,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));

  const registrationOptions = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    // The account's one handle, so this credential joins the entry the
    // reader's password manager already has rather than opening a second one.
    userID: new TextEncoder().encode(user.userHandle),
    attestationType: "none",
    // Stops the same authenticator registering twice for one account.
    excludeCredentials: existing.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports
        ? (credential.transports.split(",") as never)
        : undefined,
    })),
    authenticatorSelection: {
      /*
       * Required, not preferred, and the reason is that sign-in has no other
       * mode: `startPasskeyAuthentication` sends no `allowCredentials`, so a
       * credential the authenticator cannot find on its own can never be used
       * to sign in. "Preferred" let one be created anyway — a security key
       * with no slots left, some enterprise configurations — and the settings
       * list then showed a working passkey that was not one.
       */
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  await storeChallenge(registrationOptions.challenge, "registration", userId, {
    db,
  });
  return registrationOptions;
}

export async function finishPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  name: string | undefined,
  options: { db?: Database } = {},
): Promise<{ id: string }> {
  const db = options.db ?? getDb();

  // The challenge inside the client data is what we must match, and it must be
  // one we issued for this user.
  const clientChallenge = decodeClientDataChallenge(
    response.response.clientDataJSON,
  );
  const consumed = await consumeChallenge(clientChallenge, "registration", {
    db,
  });
  if (!consumed || consumed.userId !== userId) {
    throw new AuthError(
      "That passkey request expired. Try again.",
      "passkeyChallengeExpired",
    );
  }

  const [user] = await db
    .select({ userHandle: users.webauthnUserHandle })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    throw new AuthError(
      "Sign in again to register a passkey.",
      "passkeySignInAgain",
    );
  }

  const verified = await verifyRegistration(response, clientChallenge);
  return insertPasskey(userId, verified, name, {
    db,
    userHandle: user.userHandle,
  });
}

/** What an authenticator's answer amounts to, once it has been checked. */
export interface VerifiedRegistration {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly counter: number;
  readonly deviceType: string;
  readonly backedUp: boolean;
  readonly transports: string | null;
  /** Which model of authenticator answered, or null if it declined to say. */
  readonly aaguid: string | null;
}

/**
 * Checks an attestation against a challenge, and reduces it to the columns.
 *
 * Split out from the storing so that a signup — which has no account to store
 * against until this has succeeded — can verify first and create afterwards.
 */
async function verifyRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<VerifiedRegistration> {
  const { rpID, origin } = relyingParty();

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "Passkey registration verification failed",
    );
    throw new AuthError(
      "That passkey could not be verified.",
      "passkeyUnverified",
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new AuthError(
      "That passkey could not be verified.",
      "passkeyUnverified",
    );
  }

  const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
    verification.registrationInfo;

  return {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    transports: response.response.transports?.join(",") ?? null,
    aaguid: storableAaguid(aaguid),
  };
}

/**
 * Stores a verified credential against an account.
 *
 * Takes a `db` so a signup can write the account and its first passkey in one
 * transaction: an account with no credential at all is not a state anybody
 * should be able to land in, least of all by closing a tab.
 */
export async function insertPasskey(
  userId: string,
  verified: VerifiedRegistration,
  name: string | undefined,
  options: { db?: Database; userHandle: string },
): Promise<{ id: string }> {
  const db = options.db ?? getDb();
  try {
    const [created] = await db
      .insert(passkeys)
      .values({
        userId,
        credentialId: verified.credentialId,
        publicKey: verified.publicKey,
        counter: verified.counter,
        deviceType: verified.deviceType,
        backedUp: verified.backedUp,
        transports: verified.transports,
        // What this credential is filed under on the authenticator, recorded
        // now because every later Signal API call is keyed by it and nothing
        // else on the row can be turned into it.
        userHandle: options.userHandle,
        aaguid: verified.aaguid,
        name: name?.trim() ? name.trim().slice(0, 80) : null,
      })
      .returning({ id: passkeys.id });

    // That a passkey was registered on this instance. Not by whom, not on what
    // device, and nothing from the credential — which is a public key with an
    // identifier attached, and belongs to one person.
    await telemetry.passkeyRegistered();

    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AuthError(
        "That passkey is already registered.",
        "passkeyAlreadyRegistered",
      );
    }
    throw error;
  }
}

/**
 * Options for the passkey that will *become* an account.
 *
 * No account exists yet, so the WebAuthn user handle is a random value rather
 * than a row id, and there is nothing to exclude: an authenticator that
 * already holds a Balancia passkey for this address will say so at the
 * database's unique index, after it has proved it holds it.
 */
export async function startSignupPasskeyRegistration(
  identity: { email: string; name: string | null },
  options: { db?: Database } = {},
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const db = options.db ?? getDb();
  const { rpID, rpName } = relyingParty();
  const userHandle = mintWebauthnUserHandle();

  const registrationOptions = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: identity.email,
    // The authenticator's prompt needs a string, and this ceremony may have
    // been started before anything asked for one. The placeholder is shown
    // there and stored nowhere: `signupName` keeps what a person typed.
    userDisplayName: identity.name ?? provisionalNameFor(identity.email),
    userID: new TextEncoder().encode(userHandle),
    attestationType: "none",
    authenticatorSelection: {
      // Stronger than the signed-in ceremony asks for: this credential is the
      // only way back into the account being created, so it has to be one the
      // authenticator can find on its own without an email typed first.
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  await storeChallenge(registrationOptions.challenge, "signup", null, {
    db,
    signup: {
      email: identity.email,
      name: identity.name,
      userHandle,
    },
  });
  return registrationOptions;
}

/**
 * Verifies a signup ceremony and hands back the identity it was holding.
 *
 * Creates nothing: the caller owns the transaction that turns this into an
 * account, because it also owns the group the account may be joining.
 */
export async function verifySignupPasskeyRegistration(
  response: RegistrationResponseJSON,
  options: { db?: Database } = {},
): Promise<{
  identity: { email: string; name: string | null };
  credential: VerifiedRegistration;
  /**
   * The handle this credential was just filed under, which the account about
   * to be created must adopt as its own. Minting a second one for the row
   * would leave the reader's first passkey in an entry their second one never
   * joins.
   */
  userHandle: string;
}> {
  const db = options.db ?? getDb();
  const clientChallenge = decodeClientDataChallenge(
    response.response.clientDataJSON,
  );
  const consumed = await consumeChallenge(clientChallenge, "signup", { db });
  if (!consumed?.signup) {
    throw new AuthError(
      "That passkey request expired. Try again.",
      "passkeyChallengeExpired",
    );
  }

  return {
    identity: { email: consumed.signup.email, name: consumed.signup.name },
    credential: await verifyRegistration(response, clientChallenge),
    userHandle: consumed.signup.userHandle,
  };
}

/**
 * Options for signing in with a passkey.
 *
 * No email is required: discoverable credentials let the authenticator tell us
 * who the user is, so the sign-in page can offer "use a passkey" with no
 * identifier typed first.
 */
export async function startPasskeyAuthentication(
  options: { db?: Database } = {},
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const db = options.db ?? getDb();
  const { rpID } = relyingParty();

  const authenticationOptions = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
  });

  await storeChallenge(
    authenticationOptions.challenge,
    "authentication",
    null,
    {
      db,
    },
  );
  return authenticationOptions;
}

export async function finishPasskeyAuthentication(
  response: AuthenticationResponseJSON,
  options: { db?: Database } = {},
): Promise<{ userId: string; email: string; name: string }> {
  const db = options.db ?? getDb();
  const { rpID, origin } = relyingParty();

  const clientChallenge = decodeClientDataChallenge(
    response.response.clientDataJSON,
  );
  const consumed = await consumeChallenge(clientChallenge, "authentication", {
    db,
  });
  if (!consumed) {
    throw new AuthError(
      "That sign-in request expired. Try again.",
      "passkeySignInExpired",
    );
  }

  const [stored] = await db
    .select({
      id: passkeys.id,
      userId: passkeys.userId,
      credentialId: passkeys.credentialId,
      publicKey: passkeys.publicKey,
      counter: passkeys.counter,
      transports: passkeys.transports,
      userHandle: passkeys.userHandle,
      email: users.email,
      name: users.name,
      disabledAt: users.disabledAt,
    })
    .from(passkeys)
    .innerJoin(users, eq(users.id, passkeys.userId))
    .where(eq(passkeys.credentialId, response.id))
    .limit(1);

  if (!stored || stored.disabledAt !== null) {
    throw new AuthError(
      "That passkey is not registered here.",
      "passkeyUnknown",
    );
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: clientChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
        counter: stored.counter,
        transports: stored.transports
          ? (stored.transports.split(",") as never)
          : undefined,
      },
    });
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "Passkey authentication verification failed",
    );
    throw new AuthError(
      "That passkey could not be verified.",
      "passkeyUnverified",
    );
  }

  if (!verification.verified) {
    throw new AuthError(
      "That passkey could not be verified.",
      "passkeyUnverified",
    );
  }

  // A counter that does not advance can mean a cloned authenticator. Some
  // authenticators legitimately always report 0; only a *decrease* from a
  // non-zero counter is treated as a problem.
  const newCounter = verification.authenticationInfo.newCounter;
  if (stored.counter > 0 && newCounter <= stored.counter) {
    logger.error(
      { passkeyId: stored.id, stored: stored.counter, received: newCounter },
      "Passkey signature counter did not advance; refusing sign-in",
    );
    throw new AuthError(
      "That passkey could not be verified. If this keeps happening, remove and register it again.",
      "passkeyUnverifiedRepeatedly",
    );
  }

  /*
   * The backup state is re-read on every assertion rather than trusted from
   * registration, because it changes underneath us: a credential created
   * before somebody switched on iCloud Keychain is single-device on the day it
   * was made and synced a week later. The settings list reads these columns to
   * say whether a passkey survives a lost phone, so a frozen answer is a
   * screen telling somebody the wrong thing about their own recovery.
   */
  const { credentialDeviceType, credentialBackedUp } =
    verification.authenticationInfo;

  /*
   * What the authenticator says it filed this credential under, which is the
   * only remaining copy for any passkey made before the column existed — the
   * signup handle was discarded with its challenge row. Learning it here is
   * what lets `passkeySignalState` speak for that credential later.
   */
  const assertedHandle = decodeUserHandle(response.response.userHandle);

  await db
    .update(passkeys)
    .set({
      counter: newCounter,
      lastUsedAt: new Date(),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      ...(assertedHandle ? { userHandle: assertedHandle } : {}),
    })
    .where(eq(passkeys.id, stored.id));

  return { userId: stored.userId, email: stored.email, name: stored.name };
}

/**
 * Reads the user handle out of an assertion.
 *
 * The authenticator returns the bytes it was given at registration, which were
 * the UTF-8 of a handle string, so decoding is symmetric with the
 * `TextEncoder` on the way out. Anything that does not survive the round trip
 * is treated as absent: a handle is only useful if it matches exactly, and a
 * mangled one addressed to the Signal API would name a credential that is not
 * there.
 */
function decodeUserHandle(handle: string | undefined): string | null {
  if (!handle) return null;
  try {
    const decoded = Buffer.from(handle, "base64url").toString("utf8");
    return decoded.length > 0 && decoded.length <= 512 ? decoded : null;
  } catch {
    return null;
  }
}

export interface PasskeySummary {
  readonly id: string;
  readonly name: string | null;
  readonly deviceType: string | null;
  readonly backedUp: boolean;
  /** Names the password manager it lives in, where we can name one. */
  readonly aaguid: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

export async function listPasskeys(
  userId: string,
  options: { db?: Database } = {},
): Promise<PasskeySummary[]> {
  const db = options.db ?? getDb();
  return db
    .select({
      id: passkeys.id,
      name: passkeys.name,
      deviceType: passkeys.deviceType,
      backedUp: passkeys.backedUp,
      aaguid: passkeys.aaguid,
      createdAt: passkeys.createdAt,
      lastUsedAt: passkeys.lastUsedAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));
}

/**
 * Removes a passkey, and says which handle it was filed under.
 *
 * The handle comes back because the row is gone the moment this returns, and
 * it is the one thing the browser needs afterwards: without it, a reader who
 * removes their last passkey here still has it offered to them by their
 * password manager forever. See `passkeySignalState`.
 */
export async function deletePasskey(
  userId: string,
  passkeyId: string,
  options: { db?: Database } = {},
): Promise<{ userHandle: string | null }> {
  const db = options.db ?? getDb();
  // Scoped by user: a passkey ID from another account resolves to nothing.
  const deleted = await db
    .delete(passkeys)
    .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
    .returning({ id: passkeys.id, userHandle: passkeys.userHandle });

  if (deleted.length === 0) {
    throw new AuthError(
      "That passkey is not on your account.",
      "passkeyNotYours",
    );
  }

  return { userHandle: deleted[0].userHandle };
}

/** One handle, and every credential of this account filed under it. */
export interface PasskeySignalGroup {
  readonly userHandle: string;
  readonly credentialIds: string[];
}

/**
 * What the browser needs to bring a password manager's list back in line.
 *
 * `signalAllAcceptedCredentials` **deletes** every credential stored under a
 * handle that the list it is handed leaves out. That makes an incomplete list
 * destructive: hand it one credential when the authenticator holds two and the
 * second is thrown away, and a passkey is not recoverable. So the whole
 * account has to be knowable before any of it is signalled, and `groups` comes
 * back empty — meaning "say nothing" — the moment one row's handle is still
 * null. Those rows repair themselves at their next sign-in.
 *
 * Groups are plural because an account really can hold two handles: one
 * created by a passkey signup before this column existed, another used by
 * everything registered from the settings screen since. Each is a separate
 * entry in the reader's list and has to be reconciled on its own terms.
 */
export interface PasskeySignalState {
  /** The account's address, which is what a provider shows as the username. */
  readonly name: string;
  readonly displayName: string;
  readonly groups: PasskeySignalGroup[];
}

export async function passkeySignalState(
  userId: string,
  options: { db?: Database; alsoClear?: readonly (string | null)[] } = {},
): Promise<PasskeySignalState | null> {
  const db = options.db ?? getDb();

  const [user] = await db
    .select({
      email: users.email,
      name: users.name,
      userHandle: users.webauthnUserHandle,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;

  const rows = await db
    .select({
      credentialId: passkeys.credentialId,
      userHandle: passkeys.userHandle,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));

  // One unknown handle and the account's picture is incomplete, which is the
  // one state in which this call must not be made.
  if (rows.some((row) => row.userHandle === null)) {
    return { name: user.email, displayName: user.name, groups: [] };
  }

  const byHandle = new Map<string, string[]>();
  // The account's own handle is always spoken for, even with nothing under it:
  // that empty list is exactly what clears the entry left behind when somebody
  // removes their last passkey.
  byHandle.set(user.userHandle, []);
  for (const handle of options.alsoClear ?? []) {
    if (handle) byHandle.set(handle, byHandle.get(handle) ?? []);
  }
  for (const row of rows) {
    const handle = row.userHandle as string;
    byHandle.set(handle, [...(byHandle.get(handle) ?? []), row.credentialId]);
  }

  return {
    name: user.email,
    displayName: user.name,
    groups: [...byHandle].map(([userHandle, credentialIds]) => ({
      userHandle,
      credentialIds,
    })),
  };
}

/**
 * Reads the challenge out of the client data.
 *
 * The value is compared against a challenge the server issued and stored, so
 * decoding it here is only about knowing *which* challenge to look up — the
 * trust decision is the database lookup plus SimpleWebAuthn's verification.
 */
function decodeClientDataChallenge(clientDataJSON: string): string {
  try {
    const decoded = JSON.parse(
      Buffer.from(clientDataJSON, "base64url").toString("utf8"),
    ) as { challenge?: unknown };
    if (typeof decoded.challenge !== "string") {
      throw new Error("missing challenge");
    }
    return decoded.challenge;
  } catch {
    throw new AuthError("That request was malformed.", "malformedRequest");
  }
}

/** Deletes expired challenges. Called by the maintenance job. */
export async function pruneWebauthnChallenges(
  now: Date = new Date(),
  options: { db?: Database } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const deleted = await db
    .delete(webauthnChallenges)
    .where(lt(webauthnChallenges.expiresAt, now));
  return rowsAffected(deleted);
}
