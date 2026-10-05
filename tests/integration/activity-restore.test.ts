import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { getDb, getPool, schema, type Database } from "@/lib/db/client";
import { groupMembers, participants } from "@/lib/db/schema";
import {
  AuthorizationError,
  authorizeGroup,
  type GroupAccess,
} from "@/lib/security/authorization";
import {
  findRestorableDeletions,
  listGroupActivity,
  type ActivityEntry,
} from "@/modules/activity/service";
import {
  removeParticipant,
  restoreParticipant,
} from "@/modules/groups/service";
import {
  createExpense,
  deleteExpense,
  restoreExpense,
} from "@/modules/expenses/service";
import {
  createSettlement,
  deleteSettlement,
} from "@/modules/settlements/service";
import {
  createRecurringExpense,
  deleteRecurringExpense,
} from "@/modules/recurring/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * The Activity screen's Restore, at the point where the page decides which
 * rows get one.
 *
 * The button itself is only the restore every deletion already had. What is
 * new, and what can go wrong, is the choosing: a row offered for something
 * that is back already, a row offered twice for one thing, or a page that asks
 * the database once per row to find out.
 */

/** A client that counts the statements it sends, and nothing else. */
function countingDb(): { db: Database; statements: () => number } {
  let statements = 0;
  const db = drizzle(getPool(), {
    schema,
    casing: "snake_case",
    logger: {
      logQuery: () => {
        statements += 1;
      },
    },
  });
  return { db, statements: () => statements };
}

async function setup() {
  const actor = await createTestUser({ name: "Ada" });
  const group = await createTestGroup(actor);
  const blaise = await addTestParticipant(group.groupId, "Blaise");

  const expense = (description: string) =>
    createExpense(group.access, {
      description,
      notes: "",
      category: "",
      amount: "3000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "3000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
      ],
    });

  const settlement = () =>
    createSettlement(group.access, {
      fromParticipantId: blaise,
      toParticipantId: group.ownerParticipantId,
      amount: "1500",
      currency: "EUR",
      exchangeRate: "",
      settledOn: isoToday(),
      notes: "",
    });

  const template = () =>
    createRecurringExpense(group.access, {
      description: "Rent",
      notes: "",
      category: "home",
      subcategory: "rent",
      amount: "120000",
      currency: "EUR",
      exchangeRate: "",
      payers: [{ participantId: group.ownerParticipantId, amount: "120000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
      ],
      frequency: "monthly",
      interval: 1,
      dayOfMonth: 1,
      startDate: isoToday(-70),
      endDate: "",
    });

  return { group, blaise, expense, settlement, template };
}

/** The ids of the deletion rows naming `entityId`, newest first. */
function deletionsOf(
  entries: readonly ActivityEntry[],
  entityId: string,
): string[] {
  return entries
    .filter(
      (entry) =>
        entry.entityId === entityId && entry.action.endsWith(".deleted"),
    )
    .map((entry) => entry.id);
}

describe("which deletions the Activity screen offers to restore", () => {
  it("marks the deletions still standing, across all three kinds, in one query", async () => {
    const { group, expense, settlement, template } = await setup();

    const lost = await expense("Dinner");
    await deleteExpense(group.access, lost);

    const undone = await expense("Taxi");
    await deleteExpense(group.access, undone);
    await restoreExpense(group.access, undone);

    const repayment = await settlement();
    await deleteSettlement(group.access, repayment);

    const rent = await template();
    await deleteRecurringExpense(group.access, rent);

    const entries = await listGroupActivity(group.groupId, { limit: 100 });
    const { db, statements } = countingDb();
    const restorable = await findRestorableDeletions(group.access, entries, {
      db,
    });

    expect(restorable).toEqual(
      new Set([
        ...deletionsOf(entries, lost),
        ...deletionsOf(entries, repayment),
        ...deletionsOf(entries, rent),
      ]),
    );
    // The one that was put back is not offered again.
    expect(deletionsOf(entries, undone)).toHaveLength(1);
    expect(restorable.has(deletionsOf(entries, undone)[0]!)).toBe(false);
    // However many rows, one round trip.
    expect(statements()).toBe(1);
  });

  it("offers something deleted twice on its latest deletion only", async () => {
    const { group, expense } = await setup();

    const dinner = await expense("Dinner");
    await deleteExpense(group.access, dinner);
    await restoreExpense(group.access, dinner);
    await deleteExpense(group.access, dinner);

    const entries = await listGroupActivity(group.groupId, { limit: 100 });
    const [latest, earlier] = deletionsOf(entries, dinner);

    const restorable = await findRestorableDeletions(group.access, entries);

    expect(restorable).toEqual(new Set([latest]));
    expect(restorable.has(earlier!)).toBe(false);
  });

  it("does not offer back an expense that was turned into a repayment", async () => {
    const { group, expense, settlement } = await setup();

    // What `convertExpenseToSettlementAction` does: the repayment first, then
    // the expense it replaces, marked as replaced.
    const dinner = await expense("Dinner");
    const repayment = await settlement();
    await deleteExpense(group.access, dinner, { replacedBy: repayment });

    const entries = await listGroupActivity(group.groupId, { limit: 100 });

    expect(await findRestorableDeletions(group.access, entries)).toEqual(
      new Set(),
    );
  });

  it("offers nothing in an archived group, and asks nothing to find that out", async () => {
    const { group, expense } = await setup();
    const dinner = await expense("Dinner");
    await deleteExpense(group.access, dinner);
    const entries = await listGroupActivity(group.groupId, { limit: 100 });

    // Every restore refuses an archived group; the button would only fail.
    const archived: GroupAccess = {
      ...group.access,
      group: { ...group.access.group, archivedAt: new Date() },
    };
    const { db, statements } = countingDb();

    expect(await findRestorableDeletions(archived, entries, { db })).toEqual(
      new Set(),
    );
    expect(statements()).toBe(0);
  });

  it("offers nothing the reader's role could not restore", async () => {
    const { group, expense, settlement } = await setup();
    const dinner = await expense("Dinner");
    await deleteExpense(group.access, dinner);
    const repayment = await settlement();
    await deleteSettlement(group.access, repayment);
    const entries = await listGroupActivity(group.groupId, { limit: 100 });

    // No role lacks this today — guests included — so the access is made up.
    // The rule is that the screen asks what `restoreExpense` will ask.
    const cannotEdit: GroupAccess = {
      ...group.access,
      permissions: { ...group.access.permissions, editAnyExpense: false },
    };

    expect(await findRestorableDeletions(cannotEdit, entries)).toEqual(
      new Set(deletionsOf(entries, repayment)),
    );
  });

  it("sends no query for a page with no deletions on it", async () => {
    const { group, expense } = await setup();
    await expense("Dinner");
    const entries = await listGroupActivity(group.groupId, { limit: 100 });
    const { db, statements } = countingDb();

    expect(
      await findRestorableDeletions(group.access, entries, { db }),
    ).toEqual(new Set());
    expect(statements()).toBe(0);
  });

  it("does not reach into another group's entries", async () => {
    const { group, expense } = await setup();
    const dinner = await expense("Dinner");
    await deleteExpense(group.access, dinner);
    const theirs = await listGroupActivity(group.groupId, { limit: 100 });

    // The same rows, asked about by somebody else's group. The events are
    // filtered to the reader's group before anything is joined, so another
    // group's history cannot be used to learn what is deleted in this one.
    const other = await createTestGroup(await createTestUser());
    expect(await findRestorableDeletions(other.access, theirs)).toEqual(
      new Set(),
    );
  });
});

/** The ids of the removal rows naming `participantId`, newest first. */
function removalsOf(
  entries: readonly ActivityEntry[],
  participantId: string,
): string[] {
  return entries
    .filter(
      (entry) =>
        entry.entityId === participantId &&
        entry.action === "participant.removed",
    )
    .map((entry) => entry.id);
}

/** A second account in the group, joined as a member rather than its owner. */
async function memberAccess(groupId: string): Promise<GroupAccess> {
  const actor = await createTestUser({ name: "Mona" });
  const [seat] = await getDb()
    .insert(participants)
    .values({
      groupId,
      displayName: actor.name,
      email: actor.email,
      userId: actor.userId,
    })
    .returning({ id: participants.id });
  await getDb().insert(groupMembers).values({
    groupId,
    userId: actor.userId,
    participantId: seat!.id,
    role: "member",
  });
  return authorizeGroup(actor, groupId);
}

/** Somebody in the group through a guest link, with no account behind them. */
async function guestAccess(groupId: string): Promise<GroupAccess> {
  const participantId = await addTestParticipant(groupId, "Grace");
  return authorizeGroup(
    {
      kind: "guest",
      groupId,
      participantId,
      displayName: "Grace",
      sessionId: randomUUID(),
    },
    groupId,
  );
}

/**
 * A person taken out of the group, offered back from the line that took them
 * out. The same choosing as a deletion, and the same ways for it to go wrong,
 * with one more: the button belongs to the owner, and the Activity screen is
 * read by everybody in the group.
 */
describe("which removed people the Activity screen offers to put back", () => {
  it("marks the people still removed, beside the deletions, in one query", async () => {
    const { group, expense } = await setup();
    const cyril = await addTestParticipant(group.groupId, "Cyril");
    const dora = await addTestParticipant(group.groupId, "Dora");

    await removeParticipant(group.access, cyril);
    // Put back since: the line stays in the history, the button does not.
    await removeParticipant(group.access, dora);
    await restoreParticipant(group.access, dora);

    const dinner = await expense("Dinner");
    await deleteExpense(group.access, dinner);

    const entries = await listGroupActivity(group.groupId, { limit: 100 });
    const { db, statements } = countingDb();
    const restorable = await findRestorableDeletions(group.access, entries, {
      db,
    });

    expect(restorable).toEqual(
      new Set([...removalsOf(entries, cyril), ...deletionsOf(entries, dinner)]),
    );
    expect(removalsOf(entries, dora)).toHaveLength(1);
    expect(restorable.has(removalsOf(entries, dora)[0]!)).toBe(false);
    // People and entries together, still one round trip.
    expect(statements()).toBe(1);
  });

  it("offers somebody removed twice on the latest removal only", async () => {
    const { group } = await setup();
    const cyril = await addTestParticipant(group.groupId, "Cyril");
    await removeParticipant(group.access, cyril);
    await restoreParticipant(group.access, cyril);
    await removeParticipant(group.access, cyril);

    const entries = await listGroupActivity(group.groupId, { limit: 100 });
    const [latest, earlier] = removalsOf(entries, cyril);

    const restorable = await findRestorableDeletions(group.access, entries);

    expect(restorable).toEqual(new Set([latest]));
    expect(restorable.has(earlier!)).toBe(false);
  });

  it("offers no one back to a member or a guest, who could not put them back", async () => {
    const { group } = await setup();
    const cyril = await addTestParticipant(group.groupId, "Cyril");
    const member = await memberAccess(group.groupId);
    const guest = await guestAccess(group.groupId);
    await removeParticipant(group.access, cyril);
    const entries = await listGroupActivity(group.groupId, { limit: 100 });

    // The owner is offered it…
    expect(await findRestorableDeletions(group.access, entries)).toEqual(
      new Set(removalsOf(entries, cyril)),
    );

    // …and neither of the others is, nor asked anything to find that out:
    // this page has nothing else either of them could restore.
    for (const reader of [member, guest]) {
      const { db, statements } = countingDb();
      expect(await findRestorableDeletions(reader, entries, { db })).toEqual(
        new Set(),
      );
      expect(statements()).toBe(0);
      // The screen asks what `restoreParticipant` asks, and gets its answer.
      await expect(restoreParticipant(reader, cyril)).rejects.toThrow(
        AuthorizationError,
      );
    }
  });

  /**
   * The Activity screen's button can be pressed on a page drawn before the
   * toast's Undo was, or in a second tab. The second press is refused rather
   * than recorded, so the history does not say somebody came back twice.
   */
  it("refuses to put back somebody who is back already, and records nothing", async () => {
    const { group } = await setup();
    const cyril = await addTestParticipant(group.groupId, "Cyril");
    await removeParticipant(group.access, cyril);
    await restoreParticipant(group.access, cyril);

    await expect(restoreParticipant(group.access, cyril)).rejects.toThrow(
      AuthorizationError,
    );
    // Nor anybody who was never removed at all.
    await expect(
      restoreParticipant(group.access, group.ownerParticipantId),
    ).rejects.toThrow(AuthorizationError);

    const entries = await listGroupActivity(group.groupId, { limit: 100 });
    expect(
      entries.filter((entry) => entry.action === "participant.restored"),
    ).toHaveLength(1);
  });
});
