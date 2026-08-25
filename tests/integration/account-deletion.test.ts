import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  expenses,
  groupMembers,
  groups,
  notificationPreferences,
  participants,
  passkeys,
  pushSubscriptions,
  sessions,
  users,
} from "@/lib/db/schema";
import { deleteAccount, registerUser } from "@/modules/auth/service";
import { createSession } from "@/modules/auth/sessions";
import { createTestUser, createTestGroup } from "../helpers/factories";

/**
 * Closing an account.
 *
 * The screen promises two things at once — "your expenses stay in each group
 * under your name" and "the account, its passkeys and its preferences are gone
 * for good" — and they pull in opposite directions. Nearly every test here is
 * about the seam between them: what a `DELETE` on `users` takes with it
 * through `ON DELETE CASCADE`, and what it deliberately leaves standing
 * through `ON DELETE SET NULL`.
 *
 * They are worth writing out because the cascades are declared in the schema
 * rather than in the deletion code, so nothing in `deleteAccount` itself would
 * change if one of them were edited — the promise would simply quietly stop
 * being true.
 */

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

describe("deleting an account", () => {
  it("removes the account and frees its address for a new one", async () => {
    const email = uniqueEmail("closes");
    const actor = await createTestUser({ email });

    await deleteAccount(actor.userId);

    const db = getDb();
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, actor.userId));
    expect(rows).toHaveLength(0);

    // A tombstone row holding the address would make this impossible, and
    // somebody who closes an account and thinks better of it a week later has
    // no other way back.
    await expect(
      registerUser({
        name: "Second thoughts",
        email,
        password: "correct-horse-battery-staple",
      }),
    ).resolves.toBeTruthy();
  });

  it("leaves every expense standing, under the name it was recorded against", async () => {
    const actor = await createTestUser({ name: "Robin" });
    const group = await createTestGroup(actor, { name: "Chalet" });

    const db = getDb();
    const [expense] = await db
      .insert(expenses)
      .values({
        groupId: group.groupId,
        description: "Firewood",
        amount: 4200n,
        currency: "EUR",
        splitMethod: "equal",
        expenseDate: "2026-08-13",
        createdByActorType: "user",
        createdByParticipantId: group.ownerParticipantId,
      })
      .returning({ id: expenses.id });

    // A second member, so the group survives losing its owner.
    const other = await createTestUser();
    const [otherParticipant] = await db
      .insert(participants)
      .values({
        groupId: group.groupId,
        displayName: other.name,
        userId: other.userId,
      })
      .returning({ id: participants.id });
    await db.insert(groupMembers).values({
      groupId: group.groupId,
      userId: other.userId,
      participantId: otherParticipant.id,
      role: "member",
    });

    await deleteAccount(actor.userId);

    // The expense is untouched.
    const kept = await db
      .select()
      .from(expenses)
      .where(eq(expenses.id, expense.id));
    expect(kept).toHaveLength(1);

    // And so is the participant it points at, name included — only the link
    // to the account that is gone has been cut.
    const [who] = await db
      .select({
        displayName: participants.displayName,
        userId: participants.userId,
      })
      .from(participants)
      .where(eq(participants.id, group.ownerParticipantId));
    expect(who.displayName).toBe("Robin");
    expect(who.userId).toBeNull();
  });

  it("takes the credentials, the devices and the preferences with it", async () => {
    const actor = await createTestUser();
    const db = getDb();

    await createSession(actor.userId);
    await db.insert(passkeys).values({
      userId: actor.userId,
      credentialId: `cred-${Math.random().toString(36).slice(2)}`,
      publicKey: "key",
      counter: 0,
      transports: "internal",
    });
    await db.insert(pushSubscriptions).values({
      userId: actor.userId,
      endpoint: `https://push.test/${Math.random().toString(36).slice(2)}`,
      p256dh: "p",
      auth: "a",
    });
    await db
      .insert(notificationPreferences)
      .values({ userId: actor.userId, expensesEnabled: false });

    await deleteAccount(actor.userId);

    for (const table of [
      sessions,
      passkeys,
      pushSubscriptions,
      notificationPreferences,
    ] as const) {
      const left = await db
        .select()
        .from(table)
        .where(eq(table.userId, actor.userId));
      expect(left, `${String(table)} still holds rows`).toHaveLength(0);
    }
  });

  it("promotes the longest-standing member of a group it owned", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const db = getDb();

    // Two others, added in a known order.
    const first = await createTestUser();
    const second = await createTestUser();
    for (const [index, member] of [first, second].entries()) {
      const [participant] = await db
        .insert(participants)
        .values({
          groupId: group.groupId,
          displayName: member.name,
          userId: member.userId,
        })
        .returning({ id: participants.id });
      await db.insert(groupMembers).values({
        groupId: group.groupId,
        userId: member.userId,
        participantId: participant.id,
        role: "member",
        joinedAt: new Date(Date.now() + index * 1000),
      });
    }

    await deleteAccount(owner.userId);

    const [promoted] = await db
      .select({ role: groupMembers.role })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, group.groupId),
          eq(groupMembers.userId, first.userId),
        ),
      );
    // A group with nobody who can rename or archive it is not a crash, which
    // is exactly why nothing else would catch this.
    expect(promoted.role).toBe("owner");

    const [stillSecond] = await db
      .select({ role: groupMembers.role })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, group.groupId),
          eq(groupMembers.userId, second.userId),
        ),
      );
    expect(stillSecond.role).toBe("member");
  });

  it("removes a group nobody is left to open", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, { name: "Solo" });

    await deleteAccount(actor.userId);

    const left = await getDb()
      .select()
      .from(groups)
      .where(eq(groups.id, group.groupId));
    // Its remaining participants are names on a list rather than accounts, so
    // there is no one to promote and no way back in.
    expect(left).toHaveLength(0);
  });

  it("says nothing and does nothing for an account that is already gone", async () => {
    const actor = await createTestUser();
    await deleteAccount(actor.userId);
    await expect(deleteAccount(actor.userId)).resolves.toBeUndefined();
  });
});
