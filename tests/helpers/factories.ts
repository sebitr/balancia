import { getDb } from "@/lib/db/client";
import { groupMembers, groups, participants, users } from "@/lib/db/schema";
import type { GroupAccess, UserActor } from "@/lib/security/authorization";
import { authorizeGroup } from "@/lib/security/authorization";
import { randomUUID } from "node:crypto";

/**
 * Fixtures for integration tests.
 *
 * These write rows directly rather than going through the registration service,
 * because the code under test here is the *domain* — an expense-splitting test
 * should not fail over a password policy, or pay for scrypt on every setup.
 */

export async function createTestUser(
  overrides: { name?: string; email?: string } = {},
): Promise<UserActor> {
  const db = getDb();
  const email = overrides.email ?? `user-${randomUUID()}@example.test`;
  const name = overrides.name ?? "Test User";

  // Written directly rather than through registerUser: these fixtures support
  // domain tests, which should not pay the cost of scrypt on every setup.
  const [created] = await db
    .insert(users)
    .values({ name, email, emailVerifiedAt: new Date() })
    .returning({ id: users.id });

  return { kind: "user", userId: created.id, email, name };
}

export interface TestGroup {
  readonly groupId: string;
  readonly ownerParticipantId: string;
  readonly access: GroupAccess;
}

export async function createTestGroup(
  actor: UserActor,
  options: {
    name?: string;
    currencyMode?: "separate" | "converted";
    baseCurrency?: string | null;
    timezone?: string;
  } = {},
): Promise<TestGroup> {
  const db = getDb();
  const currencyMode = options.currencyMode ?? "separate";

  const [group] = await db
    .insert(groups)
    .values({
      name: options.name ?? "Test group",
      currencyMode,
      baseCurrency:
        currencyMode === "converted" ? (options.baseCurrency ?? "EUR") : null,
      timezone: options.timezone ?? "UTC",
      createdByUserId: actor.userId,
    })
    .returning({ id: groups.id });

  const [participant] = await db
    .insert(participants)
    .values({
      groupId: group.id,
      displayName: actor.name,
      email: actor.email,
      userId: actor.userId,
    })
    .returning({ id: participants.id });

  await db.insert(groupMembers).values({
    groupId: group.id,
    userId: actor.userId,
    participantId: participant.id,
    role: "owner",
  });

  const access = await authorizeGroup(actor, group.id);

  return {
    groupId: group.id,
    ownerParticipantId: participant.id,
    access,
  };
}

export async function addTestParticipant(
  groupId: string,
  displayName: string,
): Promise<string> {
  const db = getDb();
  const [participant] = await db
    .insert(participants)
    .values({ groupId, displayName })
    .returning({ id: participants.id });
  return participant.id;
}

/** Today's date as YYYY-MM-DD, for expense dates in tests. */
export function isoToday(offsetDays = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
