import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { groupMembers, groups, participants } from "@/lib/db/schema";

/**
 * Central authorization.
 *
 * Every group-scoped read and mutation passes through `authorizeGroup`. The
 * function takes the *claimed* group ID and the actor, and answers with an
 * `GroupAccess` that carries the group ID it actually verified. Callers then
 * scope their queries with that verified ID.
 *
 * Two rules make insecure direct object references hard to write here:
 *
 *  1. Authorization runs before the record is fetched, never after. There is no
 *     "load the expense, then check its group" path — repository helpers take a
 *     group ID and filter on it.
 *  2. A guest's access is pinned to the group in their session. Passing a
 *     different group ID cannot widen it; it can only fail.
 */

export type ActorKind = "user" | "guest";

export interface UserActor {
  readonly kind: "user";
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

export interface GuestActor {
  readonly kind: "guest";
  readonly groupId: string;
  readonly participantId: string;
  readonly displayName: string;
  readonly sessionId: string;
}

export type Actor = UserActor | GuestActor;

/** What an actor is allowed to do inside one group. */
export interface GroupPermissions {
  readonly viewGroup: boolean;
  readonly addExpense: boolean;
  readonly editAnyExpense: boolean;
  readonly addSettlement: boolean;
  readonly uploadReceipt: boolean;
  readonly manageRecurring: boolean;
  readonly manageParticipants: boolean;
  readonly manageInvitations: boolean;
  readonly manageGroupSettings: boolean;
  readonly importData: boolean;
  readonly exportData: boolean;
  readonly deleteGroup: boolean;
  readonly transferOwnership: boolean;
}

export interface GroupAccess {
  /** The group the actor is verified against. Use this, not the request's value. */
  readonly groupId: string;
  readonly actor: Actor;
  /** The actor's participant row in this group, if they have one. */
  readonly participantId: string | null;
  readonly role: "owner" | "member" | "guest";
  readonly permissions: GroupPermissions;
  readonly group: {
    readonly id: string;
    readonly name: string;
    readonly currencyMode: "separate" | "converted";
    readonly baseCurrency: string | null;
    readonly timezone: string;
    readonly archivedAt: Date | null;
  };
}

export class AuthorizationError extends Error {
  /** Translated by the Server Action funnel; see `lib/actions.ts`. */
  readonly code: string;

  constructor(
    message = "You do not have access to this group.",
    code = "noGroupAccess",
  ) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
  }
}

export class AuthenticationRequiredError extends Error {
  readonly code = "authRequired";

  constructor(message = "Sign in to continue.") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

/**
 * Guests are full financial participants: they can record and edit expenses,
 * settle up and upload receipts. What they cannot do is anything that would
 * let them escalate — managing people, links, group settings, ownership or
 * deletion.
 *
 * Bulk export is withheld for a different reason than the rest: a guest can
 * already read every expense on screen, so this is not about secrecy. It is
 * that an invitation link is a bearer token which may be forwarded, and a
 * one-request download of the group's entire financial history is a sharper
 * tool in the wrong hands than the same data read a page at a time.
 */
const GUEST_PERMISSIONS: GroupPermissions = {
  viewGroup: true,
  addExpense: true,
  editAnyExpense: true,
  addSettlement: true,
  uploadReceipt: true,
  manageRecurring: true,
  manageParticipants: false,
  manageInvitations: false,
  manageGroupSettings: false,
  importData: false,
  exportData: false,
  deleteGroup: false,
  transferOwnership: false,
};

const MEMBER_PERMISSIONS: GroupPermissions = {
  viewGroup: true,
  addExpense: true,
  editAnyExpense: true,
  addSettlement: true,
  uploadReceipt: true,
  manageRecurring: true,
  manageParticipants: true,
  manageInvitations: true,
  manageGroupSettings: false,
  importData: true,
  exportData: true,
  deleteGroup: false,
  transferOwnership: false,
};

const OWNER_PERMISSIONS: GroupPermissions = {
  viewGroup: true,
  addExpense: true,
  editAnyExpense: true,
  addSettlement: true,
  uploadReceipt: true,
  manageRecurring: true,
  manageParticipants: true,
  manageInvitations: true,
  manageGroupSettings: true,
  importData: true,
  exportData: true,
  deleteGroup: true,
  transferOwnership: true,
};

export function permissionsForRole(
  role: "owner" | "member" | "guest",
): GroupPermissions {
  switch (role) {
    case "owner":
      return OWNER_PERMISSIONS;
    case "member":
      return MEMBER_PERMISSIONS;
    case "guest":
      return GUEST_PERMISSIONS;
  }
}

/**
 * Verifies that `actor` may act inside `groupId`, returning the access context.
 * Throws AuthorizationError otherwise — callers should not catch it to fall
 * back to a wider query.
 */
export async function authorizeGroup(
  actor: Actor | null,
  groupId: string,
  options: { db?: Database; requireActive?: boolean } = {},
): Promise<GroupAccess> {
  if (!actor) {
    throw new AuthenticationRequiredError();
  }
  const db = options.db ?? getDb();

  if (actor.kind === "guest") {
    // A guest session names exactly one group. Any other target is a refusal,
    // never a lookup.
    if (actor.groupId !== groupId) {
      throw new AuthorizationError();
    }
    const [group] = await db
      .select({
        id: groups.id,
        name: groups.name,
        currencyMode: groups.currencyMode,
        baseCurrency: groups.baseCurrency,
        timezone: groups.timezone,
        archivedAt: groups.archivedAt,
      })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);

    if (!group) {
      throw new AuthorizationError();
    }
    assertWritable(group.archivedAt, options.requireActive);

    return {
      groupId: group.id,
      actor,
      participantId: actor.participantId,
      role: "guest",
      permissions: GUEST_PERMISSIONS,
      group,
    };
  }

  const [membership] = await db
    .select({
      role: groupMembers.role,
      participantId: groupMembers.participantId,
      id: groups.id,
      name: groups.name,
      currencyMode: groups.currencyMode,
      baseCurrency: groups.baseCurrency,
      timezone: groups.timezone,
      archivedAt: groups.archivedAt,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, actor.userId),
      ),
    )
    .limit(1);

  if (!membership) {
    // Deliberately identical to "group does not exist": membership is not
    // something an outsider should be able to probe for.
    throw new AuthorizationError();
  }
  assertWritable(membership.archivedAt, options.requireActive);

  return {
    groupId: membership.id,
    actor,
    participantId: membership.participantId,
    role: membership.role,
    permissions: permissionsForRole(membership.role),
    group: {
      id: membership.id,
      name: membership.name,
      currencyMode: membership.currencyMode,
      baseCurrency: membership.baseCurrency,
      timezone: membership.timezone,
      archivedAt: membership.archivedAt,
    },
  };
}

function assertWritable(
  archivedAt: Date | null,
  requireActive: boolean | undefined,
): void {
  if (requireActive && archivedAt !== null) {
    throw new AuthorizationError(
      "This group is archived. Restore it before making changes.",
    );
  }
}

/** Throws unless the access context grants `permission`. */
export function requirePermission(
  access: GroupAccess,
  permission: keyof GroupPermissions,
): void {
  if (!access.permissions[permission]) {
    throw new AuthorizationError(
      "You do not have permission to perform this action in this group.",
    );
  }
}

/**
 * Resolves the participant an actor writes as. Every financial record is
 * attributed to a participant, including records created by guests.
 */
export async function resolveActorParticipant(
  access: GroupAccess,
  options: { db?: Database } = {},
): Promise<string | null> {
  if (access.participantId) return access.participantId;
  if (access.actor.kind !== "user") return null;

  const db = options.db ?? getDb();
  const [participant] = await db
    .select({ id: participants.id })
    .from(participants)
    .where(
      and(
        eq(participants.groupId, access.groupId),
        eq(participants.userId, access.actor.userId),
        isNull(participants.removedAt),
      ),
    )
    .limit(1);
  return participant?.id ?? null;
}
