import "server-only";
import { and, count, eq, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import {
  groupJoinLinks,
  groups,
  guestInvitations,
  participants,
  users,
} from "@/lib/db/schema";
import { hashToken, isWellFormedToken } from "@/lib/security/tokens";
import {
  InvalidJoinLinkError,
  resolveJoinLink,
  touchJoinLink,
} from "@/lib/security/join-link";
import { logger } from "@/lib/logger";
import { claimMember, createMember, type JoinOutcome } from "./service";

/**
 * Opening a join link without a browser.
 *
 * The web redeems a link as a cookie handshake: the browser GETs
 * `/join/g/<token>`, the server spends the token into a cookie and redirects,
 * and the screens that follow read that cookie. A native client cannot join
 * that dance — and it must never fetch the web URL to find out what a link is,
 * because loading that page is itself the act of taking it.
 *
 * So the two halves are separated here, and that separation is the whole point
 * of this module:
 *
 *   - **Reading** a link (`previewGroupLink`, `previewInvitation`) touches
 *     nothing. No cookie, no session, no `lastUsedAt`, no participant bound to
 *     anybody. Safe to call twice, safe to call and then abandon.
 *   - **Taking** it (`redeemGroupLink`, `redeemInvitationAs`) is the mutation,
 *     and it is the only half that needs an account.
 *
 * Both halves resolve the token themselves rather than reading a cookie, which
 * is what `signup-join.ts` next door does for the browser. Note what that
 * changes and what it does not: the group being joined still comes from the
 * token, never from the caller, so a request cannot name a group it was not
 * given a link to.
 */

/**
 * Why a link cannot be opened, in the vocabulary the routes translate.
 *
 * `invalid` is kept apart from the two lapsed states because the reader can act
 * on the difference — a link that never existed is a typo, one that expired is
 * worth asking the group about — and because the routes answer 404 for the
 * first and 410 for the rest.
 */
export type JoinRefusalCode = "invalid" | "expired" | "revoked" | "taken";

export class JoinLinkRefused extends Error {
  readonly code: JoinRefusalCode;

  constructor(code: JoinRefusalCode) {
    super(`Join link refused: ${code}`);
    this.name = "JoinLinkRefused";
    this.code = code;
  }
}

/**
 * What a link is worth showing before anybody commits to it.
 *
 * Deliberately the same shape for both kinds, because the sheet that renders it
 * is the same sheet. `participantName` is what separates them in practice: a
 * personal invitation reserves a seat and can say whose, a group-wide link has
 * identified nobody yet.
 */
export interface JoinPreview {
  readonly groupId: string;
  readonly groupName: string;
  /** Icon and accent slugs, the same vocabulary as the group DTO. */
  readonly icon: string | null;
  readonly iconColor: string | null;
  readonly memberCount: number;
  /** Who made the link. Null when that account is gone. */
  readonly invitedBy: string | null;
  /** The seat a personal invitation reserves; null for a group-wide link. */
  readonly participantName: string | null;
  readonly expiresAt: string | null;
  /** Whether the *caller* is already in the group. False when signed out. */
  readonly alreadyMember: boolean;
}

/** The group facts the preview adds on top of resolving the token. */
async function decorate(
  db: Database,
  groupId: string,
  viewerUserId: string | null,
): Promise<{
  icon: string | null;
  iconColor: string | null;
  memberCount: number;
  alreadyMember: boolean;
}> {
  const [group, tally, existing] = await Promise.all([
    db
      .select({ icon: groups.icon, iconColor: groups.iconColor })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1),
    db
      .select({ total: count(participants.id) })
      .from(participants)
      .where(
        and(eq(participants.groupId, groupId), isNull(participants.removedAt)),
      ),
    // Deliberately *not* filtered by `removedAt`, so that this agrees with
    // what taking the link would do. `claimMember` and `createMember` both
    // answer `already-member` for a row this account holds whether or not it
    // was removed, and neither restores it — so a preview that filtered
    // removed seats out would promise a join that comes back as a no-op, and
    // send the app to a group it cannot open.
    viewerUserId
      ? db
          .select({ id: participants.id })
          .from(participants)
          .where(
            and(
              eq(participants.groupId, groupId),
              eq(participants.userId, viewerUserId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  return {
    icon: group[0]?.icon ?? null,
    iconColor: group[0]?.iconColor ?? null,
    memberCount: tally[0]?.total ?? 0,
    alreadyMember: existing.length > 0,
  };
}

/** Translates the link module's failure vocabulary into this one. */
function refuse(error: unknown): never {
  if (error instanceof InvalidJoinLinkError) {
    throw new JoinLinkRefused(error.reason);
  }
  throw error;
}

/**
 * A group-wide link, read and not taken.
 *
 * `resolveJoinLink` is the authority on whether the token is any good — it is
 * already a pure read, and reusing it is what keeps this from drifting away
 * from what the browser accepts. The rest is decoration.
 */
export async function previewGroupLink(
  token: string,
  viewerUserId: string | null,
  options: { db?: Database } = {},
): Promise<JoinPreview> {
  const db = options.db ?? getDb();
  const link = await resolveJoinLink(token, { db }).catch(refuse);

  const [decoration, rows] = await Promise.all([
    decorate(db, link.groupId, viewerUserId),
    db
      .select({ expiresAt: groupJoinLinks.expiresAt })
      .from(groupJoinLinks)
      .where(eq(groupJoinLinks.id, link.linkId))
      .limit(1),
  ]);

  return {
    groupId: link.groupId,
    groupName: link.groupName,
    invitedBy: link.inviterName,
    participantName: null,
    expiresAt: rows[0]?.expiresAt?.toISOString() ?? null,
    ...decoration,
  };
}

interface ResolvedInvitation {
  readonly invitationId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly participantId: string;
  readonly participantName: string;
  readonly inviterName: string | null;
  readonly expiresAt: Date | null;
}

/**
 * An invitation row, checked for the same three ways of being over.
 *
 * The web has no equivalent: `redeemInvitation` in `lib/security/guest-session`
 * does these checks on its way to minting a session, and there was never a
 * caller that wanted the checks without the session. A preview is exactly that
 * caller, so the reading half lives here — and reads only.
 */
async function resolveInvitation(
  db: Database,
  token: string,
  now: Date,
): Promise<ResolvedInvitation> {
  if (!isWellFormedToken(token)) throw new JoinLinkRefused("invalid");

  const [row] = await db
    .select({
      id: guestInvitations.id,
      groupId: guestInvitations.groupId,
      participantId: guestInvitations.participantId,
      expiresAt: guestInvitations.expiresAt,
      revokedAt: guestInvitations.revokedAt,
      groupName: groups.name,
      groupArchivedAt: groups.archivedAt,
      participantName: participants.displayName,
      participantRemovedAt: participants.removedAt,
      inviterName: users.name,
    })
    .from(guestInvitations)
    .innerJoin(groups, eq(groups.id, guestInvitations.groupId))
    .innerJoin(
      participants,
      eq(participants.id, guestInvitations.participantId),
    )
    .leftJoin(users, eq(users.id, guestInvitations.createdByUserId))
    .where(eq(guestInvitations.tokenHash, hashToken(token)))
    .limit(1);

  // A deleted group takes its invitations with it, so a vanished row and a typo
  // are the same answer — the one that says least.
  if (!row) throw new JoinLinkRefused("invalid");
  // Matching `resolveJoinLink`: an archived group is closed to newcomers and
  // reads as a link that was turned off, not as a group that exists.
  if (row.groupArchivedAt !== null) throw new JoinLinkRefused("revoked");
  if (row.revokedAt !== null) throw new JoinLinkRefused("revoked");
  // The seat itself is gone. There is nothing left to join.
  if (row.participantRemovedAt !== null) throw new JoinLinkRefused("revoked");
  if (row.expiresAt !== null && row.expiresAt <= now) {
    throw new JoinLinkRefused("expired");
  }

  return {
    invitationId: row.id,
    groupId: row.groupId,
    groupName: row.groupName,
    participantId: row.participantId,
    participantName: row.participantName,
    inviterName: row.inviterName,
    expiresAt: row.expiresAt,
  };
}

/** A personal invitation, read and not taken. */
export async function previewInvitation(
  token: string,
  viewerUserId: string | null,
  options: { db?: Database; now?: Date } = {},
): Promise<JoinPreview> {
  const db = options.db ?? getDb();
  const invitation = await resolveInvitation(
    db,
    token,
    options.now ?? new Date(),
  );
  const decoration = await decorate(db, invitation.groupId, viewerUserId);

  return {
    groupId: invitation.groupId,
    groupName: invitation.groupName,
    invitedBy: invitation.inviterName,
    participantName: invitation.participantName,
    expiresAt: invitation.expiresAt?.toISOString() ?? null,
    ...decoration,
  };
}

export interface JoinResult {
  readonly groupId: string;
  readonly participantId: string;
}

/**
 * Turns the service's outcome into an answer or a refusal.
 *
 * `already-member` is deliberately a success. A double-tap on "Join" must not
 * read as a failure, and the second call is telling the truth about where the
 * caller now is.
 */
function settle(outcome: JoinOutcome, groupId: string): JoinResult {
  if (outcome.status === "taken") throw new JoinLinkRefused("taken");
  return { groupId, participantId: outcome.participantId };
}

/**
 * Taking a group-wide link.
 *
 * Two ways in, the same fork the browser offers: claim one of the names the
 * group is already keeping, or arrive as somebody new. A caller who says
 * neither becomes a new participant under the name on their account, which is
 * what the sheet does when it has no list to offer.
 */
export async function redeemGroupLink(
  input: {
    readonly token: string;
    readonly userId: string;
    readonly participantId?: string | null;
    readonly displayName: string;
  },
  options: { db?: Database } = {},
): Promise<JoinResult> {
  const db = options.db ?? getDb();
  const link = await resolveJoinLink(input.token, { db }).catch(refuse);

  const outcome = input.participantId
    ? await claimMember(
        {
          groupId: link.groupId,
          participantId: input.participantId,
          userId: input.userId,
        },
        { db },
      )
    : await createMember(
        {
          groupId: link.groupId,
          userId: input.userId,
          displayName: input.displayName,
        },
        { db },
      );

  // Bookkeeping only: a link that worked must not fail on the write recording
  // that it was used.
  void touchJoinLink(link.linkId, { db }).catch(() => undefined);

  logger.info(
    { groupId: link.groupId, outcome: outcome.status },
    "Group join link redeemed over the API",
  );
  return settle(outcome, link.groupId);
}

/**
 * Taking a personal invitation.
 *
 * There is no fork here: the token names the seat, so the only question is
 * whether this account may have it. `claimMember` answers that in the UPDATE
 * predicate — a seat somebody else's account already holds comes back as
 * `taken`, which is the invitation that was minted for somebody else.
 *
 * Note what this does *not* do: it mints no guest session. The web route next
 * door does, because on the web this link is how a person with no account gets
 * one. A caller here already has an account, so the invitation resolves to the
 * thing the guest session was standing in for all along — membership.
 */
export async function redeemInvitationAs(
  input: { readonly token: string; readonly userId: string },
  options: { db?: Database; now?: Date } = {},
): Promise<JoinResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const invitation = await resolveInvitation(db, input.token, now);

  const outcome = await claimMember(
    {
      groupId: invitation.groupId,
      participantId: invitation.participantId,
      userId: input.userId,
    },
    { db },
  );

  void Promise.resolve(
    db
      .update(guestInvitations)
      .set({ lastUsedAt: now })
      .where(eq(guestInvitations.id, invitation.invitationId)),
  ).catch(() => undefined);

  logger.info(
    { groupId: invitation.groupId, outcome: outcome.status },
    "Invitation redeemed over the API",
  );
  return settle(outcome, invitation.groupId);
}
