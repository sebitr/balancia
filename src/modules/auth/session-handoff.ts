import "server-only";
import { logger } from "@/lib/logger";
import { claimGuestSession } from "@/modules/guests/service";
import { joinAfterSignup } from "@/modules/join/signup-join";
import { clearGuestCookie, readGuestCookie, setSessionCookie } from "./cookies";

/**
 * What happens to a browser the moment it becomes signed in.
 *
 * Deliberately not in `actions.ts`. Every export of a `"use server"` module is
 * a callable endpoint, and `settleNewSession` takes a user id — as an action it
 * would let anybody hand a stranger's account whatever this browser's guest
 * cookie is holding. Here it is reachable only from code that has already
 * decided who signed in.
 */

/**
 * Claims the guest identity this browser is holding, if it holds one.
 *
 * Called from both sign-up and sign-in, because the session that makes a claim
 * possible arrives at different moments: an instance with SMTP configured
 * issues none until the address is verified, so for those the claim lands on
 * the first sign-in instead. It is also what makes "I already have an account"
 * work from the invite screen.
 *
 * Failures are logged and swallowed. The authentication has already succeeded,
 * and nobody should be left without a session because the link they arrived on
 * could not be retired.
 */
export async function claimGuestIdentity(
  userId: string,
): Promise<string | null> {
  const guestToken = await readGuestCookie();
  if (!guestToken) return null;

  try {
    const outcome = await claimGuestSession(userId, guestToken);
    if (outcome.status === "claimed") {
      await clearGuestCookie();
      return outcome.groupId;
    }
    // A dead cookie buys nobody anything. A conflicting one is kept: the claim
    // was skipped, so signing out should still return them to the guest.
    if (outcome.status === "none") {
      await clearGuestCookie();
    }
    return null;
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Guest claim failed after authentication",
    );
    return null;
  }
}

export interface CodeAuthResult {
  /** The group a guest session brought across, when there was one. */
  readonly claimedGroupId: string | null;
  /** The group a shared link put this account into, when there was one. */
  readonly joinedGroupId: string | null;
  /** Somebody else claimed that listed name first. */
  readonly taken: boolean;
}

/**
 * Everything that follows a session being issued, wherever it came from.
 *
 * Shared by both code actions and by the passkey signup route, so that the
 * cookie, the guest claim and the group join cannot drift apart between three
 * copies of the same four lines.
 */
export async function settleNewSession(
  userId: string,
  session: { token: string; expiresAt: Date },
  input: {
    join?: { participantId: string | null; displayName: string } | undefined;
  },
): Promise<CodeAuthResult> {
  await setSessionCookie(session.token, session.expiresAt);
  const claimedGroupId = await claimGuestIdentity(userId);

  const joined = input.join
    ? await joinAfterSignup(userId, {
        participantId: input.join.participantId,
        displayName: input.join.displayName,
      })
    : null;

  return {
    claimedGroupId,
    joinedGroupId: joined && joined.status !== "taken" ? joined.groupId : null,
    taken: joined?.status === "taken",
  };
}
