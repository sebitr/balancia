import "server-only";
import { resolveJoinLink } from "@/lib/security/join-link";
import { clearJoinCookie, readJoinCookie } from "@/modules/auth/cookies";
import { logger } from "@/lib/logger";
import { claimMember, createMember, type JoinOutcome } from "./service";

/**
 * Putting a brand-new account into the group whose link it arrived on.
 *
 * This is the second half of every signup that started at a shared link, and
 * it is separate from the credential half because the credentials now differ:
 * a password signup finishes in a Server Action, a passkey signup finishes in
 * a route handler, and a code signup finishes on a second request entirely.
 * All three end here.
 *
 * The group is re-resolved from the join cookie rather than taken from the
 * caller. That is the rule the whole flow rests on: the form may say which
 * *participant* is being claimed, because the list it chose from came from the
 * link — but which group is being joined comes from the credential in the
 * cookie, or a request could name any group it liked.
 *
 * Returns null when there is no join cookie, which is the ordinary state for a
 * personal invitation and for a cold signup. Neither of those joins anything
 * here: an invitation has already spent its token into a guest session, and a
 * cold signup has no group to belong to yet.
 */
export async function joinAfterSignup(
  userId: string,
  member: {
    /** The listed member being claimed, or null for somebody new. */
    readonly participantId: string | null;
    readonly displayName: string;
  },
): Promise<(JoinOutcome & { groupId: string }) | null> {
  const cookie = await readJoinCookie();
  if (!cookie) return null;

  let link: Awaited<ReturnType<typeof resolveJoinLink>>;
  try {
    link = await resolveJoinLink(cookie);
  } catch (error) {
    /*
     * The account exists and the session is real; only the group is lost.
     *
     * That is the recoverable direction, and it is the one the join flow has
     * always chosen — better a usable account outside the group than a failed
     * signup whose credential was already registered. The link can be opened
     * again.
     */
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "Signup finished with a join link that no longer resolves",
    );
    await clearJoinCookie();
    return null;
  }

  const outcome: JoinOutcome = member.participantId
    ? await claimMember({
        groupId: link.groupId,
        participantId: member.participantId,
        userId,
      })
    : await createMember({
        groupId: link.groupId,
        userId,
        displayName: member.displayName,
      });

  // The decision is made either way, so the cookie has no further use. A lost
  // race clears it too: retrying needs a fresh read of the list.
  await clearJoinCookie();

  // The group's own pages are now stale — but revalidating is the framework's
  // vocabulary, and this module is not allowed to speak it. The action or the
  // route handler that called this does it, on the id returned here.
  return { ...outcome, groupId: link.groupId };
}
