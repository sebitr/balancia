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
import { getDb, type Database } from "@/lib/db/client";
import { passkeys, users, webauthnChallenges } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { AuthError, isUniqueViolation } from "./service";

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

async function storeChallenge(
  challenge: string,
  kind: "registration" | "authentication",
  userId: string | null,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db.insert(webauthnChallenges).values({
    userId,
    challenge,
    kind,
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
  kind: "registration" | "authentication",
  options: { db?: Database } = {},
): Promise<{ userId: string | null } | null> {
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
    .returning({ userId: webauthnChallenges.userId });

  return row ? { userId: row.userId } : null;
}

/** Options for registering a new passkey on the signed-in user's account. */
export async function startPasskeyRegistration(
  userId: string,
  options: { db?: Database } = {},
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const db = options.db ?? getDb();
  const { rpID, rpName } = relyingParty();

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    throw new AuthError("Sign in again to register a passkey.");
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
    // Stable per-account handle so re-registering replaces rather than
    // duplicates the credential on the authenticator.
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    // Stops the same authenticator registering twice for one account.
    excludeCredentials: existing.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports
        ? (credential.transports.split(",") as never)
        : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
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
  const { rpID, origin } = relyingParty();

  // The challenge inside the client data is what we must match, and it must be
  // one we issued for this user.
  const clientChallenge = decodeClientDataChallenge(
    response.response.clientDataJSON,
  );
  const consumed = await consumeChallenge(clientChallenge, "registration", {
    db,
  });
  if (!consumed || consumed.userId !== userId) {
    throw new AuthError("That passkey request expired. Try again.");
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: clientChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "Passkey registration verification failed",
    );
    throw new AuthError("That passkey could not be verified.");
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new AuthError("That passkey could not be verified.");
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  try {
    const [created] = await db
      .insert(passkeys)
      .values({
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: response.response.transports?.join(",") ?? null,
        name: name?.trim() ? name.trim().slice(0, 80) : null,
      })
      .returning({ id: passkeys.id });
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AuthError("That passkey is already registered.");
    }
    throw error;
  }
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
    throw new AuthError("That sign-in request expired. Try again.");
  }

  const [stored] = await db
    .select({
      id: passkeys.id,
      userId: passkeys.userId,
      credentialId: passkeys.credentialId,
      publicKey: passkeys.publicKey,
      counter: passkeys.counter,
      transports: passkeys.transports,
      email: users.email,
      name: users.name,
      disabledAt: users.disabledAt,
    })
    .from(passkeys)
    .innerJoin(users, eq(users.id, passkeys.userId))
    .where(eq(passkeys.credentialId, response.id))
    .limit(1);

  if (!stored || stored.disabledAt !== null) {
    throw new AuthError("That passkey is not registered here.");
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
    throw new AuthError("That passkey could not be verified.");
  }

  if (!verification.verified) {
    throw new AuthError("That passkey could not be verified.");
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
    );
  }

  await db
    .update(passkeys)
    .set({ counter: newCounter, lastUsedAt: new Date() })
    .where(eq(passkeys.id, stored.id));

  return { userId: stored.userId, email: stored.email, name: stored.name };
}

export interface PasskeySummary {
  readonly id: string;
  readonly name: string | null;
  readonly deviceType: string | null;
  readonly backedUp: boolean;
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
      createdAt: passkeys.createdAt,
      lastUsedAt: passkeys.lastUsedAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));
}

export async function deletePasskey(
  userId: string,
  passkeyId: string,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  // Scoped by user: a passkey ID from another account resolves to nothing.
  const deleted = await db
    .delete(passkeys)
    .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
    .returning({ id: passkeys.id });

  if (deleted.length === 0) {
    throw new AuthError("That passkey is not on your account.");
  }
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
    throw new AuthError("That request was malformed.");
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
    .where(lt(webauthnChallenges.expiresAt, now))
    .returning({ id: webauthnChallenges.id });
  return deleted.length;
}
