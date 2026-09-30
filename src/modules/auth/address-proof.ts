import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  oauthIdentities,
  passkeys,
  users,
  verificationTokens,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { revokeAllApiTokensForUser } from "@/modules/api-tokens/service";
import { revokeAllSessionsForUser } from "./sessions";

/**
 * The first time an address is proved, and what that takes away.
 *
 * An account can exist long before anybody has shown they read its inbox. A
 * passkey signup is the plain case: it takes the address on trust and signs the
 * new account in on the authenticator alone, which is right for the person
 * arriving — and means the address on the row may belong to somebody else
 * entirely. Nothing stops a stranger registering `you@example.com` with their
 * own passkey, and everything they add from then on hangs off a row that will
 * one day be yours.
 *
 * The owner of the inbox can always get in: a reset link or a sign-in code
 * turns the inbox into the account, which is what recovery is for. What they
 * must not inherit is a way in they did not make. So the first proof of an
 * address draws a line under the account. Every passkey, Apple link, API key,
 * pending email change and session from before it goes, and the person who
 * proved it starts with only what the proof itself hands them — a password, or
 * one new session.
 *
 * All of them, not the ones a stranger would plausibly have left. A passkey
 * made by the owner's own signup and one made by somebody squatting the
 * address are the same ceremony and the same row; the one fact on the server
 * that tells them apart is who can read the inbox, and that is the fact being
 * established here. An owner who signed up with a passkey and proves the
 * address later loses that passkey too, and adds it again from the security
 * screen — a cost paid once, and the reason an operator switching SMTP on is
 * told to mark the addresses already there as verified first.
 *
 * Decided in the UPDATE's own predicate, so exactly one proof is ever the
 * first: two sign-in codes spent at once cannot both evict, and the second
 * cannot revoke the session the first has just been handed. The caller runs
 * this inside the transaction that does the rest of its work, so the address
 * is never verified with the old credentials still standing, even for a
 * moment.
 */
export async function proveAddress(
  userId: string,
  options: {
    db: Database;
    /**
     * What becomes of a password set before the proof, which each caller has
     * to say out loud rather than inherit.
     *
     * `drop` wherever the person proving the inbox need not be the person who
     * chose it — a code spent against an account somebody registered with a
     * password is the same squat as a passkey, and the rule
     * `reclaimUnclaimedAccount` already keeps applies. `keep` for the
     * confirmation link, which went to the person who registered with that
     * password, and for a reset, which replaces it in the same transaction.
     */
    password: "keep" | "drop";
    now?: Date;
  },
): Promise<boolean> {
  const { db } = options;
  const now = options.now ?? new Date();

  const [proved] = await db
    .update(users)
    .set({
      emailVerifiedAt: now,
      updatedAt: now,
      ...(options.password === "drop" ? { passwordHash: null } : {}),
    })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)))
    .returning({ id: users.id });
  if (!proved) return false;

  const removedPasskeys = await db
    .delete(passkeys)
    .where(eq(passkeys.userId, userId))
    .returning({ id: passkeys.id });
  const removedLinks = await db
    .delete(oauthIdentities)
    .where(eq(oauthIdentities.userId, userId))
    .returning({ id: oauthIdentities.id });
  const revokedKeys = await revokeAllApiTokensForUser(userId, { db, now });
  await endPendingEmailChanges(userId, { db, now });
  const endedSessions = await revokeAllSessionsForUser(userId, { db });

  logger.info(
    {
      userId,
      passkeys: removedPasskeys.length,
      appleLinks: removedLinks.length,
      apiKeys: revokedKeys,
      sessions: endedSessions,
    },
    "Address proved for the first time; earlier credentials removed",
  );
  return true;
}

/**
 * Spends every email change still waiting to be confirmed.
 *
 * A pending change is a credential in all but name: its link needs no session,
 * lands in whatever inbox the requester chose, and once opened moves the
 * account's recovery channel there. The notice mailed to the old address tells
 * the owner to reset their password if the change was not theirs — so the
 * reset has to be what stops it, or the advice is a trap. The session that
 * asked is gone by then; the link it left behind must go with it.
 */
export async function endPendingEmailChanges(
  userId: string,
  options: { db: Database; now?: Date },
): Promise<void> {
  await options.db
    .update(verificationTokens)
    .set({ consumedAt: options.now ?? new Date() })
    .where(
      and(
        eq(verificationTokens.userId, userId),
        eq(verificationTokens.purpose, "email_change"),
        isNull(verificationTokens.consumedAt),
      ),
    );
}
