import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import {
  activityEvents,
  expensePayers,
  expenseShares,
  expenses,
  groups,
  participants,
  settlements,
} from "@/lib/db/schema";
import {
  createGroup,
  deleteGroup,
  listParticipants,
} from "@/modules/groups/service";
import { createExpense } from "@/modules/expenses/service";
import { createSettlement } from "@/modules/settlements/service";
import { authorizeGroup } from "@/lib/security/authorization";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * Group creation, including the people named alongside it.
 *
 * The property that matters is atomicity: a group whose members half-exist
 * would be worse than one that failed to be created at all, because the
 * organiser would not know which half to add by hand.
 */

const BASE = {
  description: "",
  currencyMode: "separate" as const,
  timezone: "UTC",
};

describe("createGroup", () => {
  it("creates the group with only its owner when no names are given", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const created = await createGroup(actor, {
      ...BASE,
      name: "Solo",
      ownerDisplayName: "Amélie",
    });

    const people = await listParticipants(created.id);
    expect(people).toHaveLength(1);
    expect(people[0].displayName).toBe("Amélie");
    expect(people[0].role).toBe("owner");
  });

  it("creates the people named alongside the group, without accounts", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const created = await createGroup(actor, {
      ...BASE,
      name: "Lisbon trip",
      ownerDisplayName: "Amélie",
      participantNames: ["Blaise", "Jonas", "Ravi"],
    });

    const people = await listParticipants(created.id);
    expect(people.map((person) => person.displayName)).toEqual([
      "Amélie",
      "Blaise",
      "Jonas",
      "Ravi",
    ]);

    // Everyone but the owner is an account-less participant.
    const guests = people.filter((person) => person.role === "guest");
    expect(guests).toHaveLength(3);
    expect(guests.every((person) => person.userId === null)).toBe(true);
    expect(guests.every((person) => !person.hasActiveInvitation)).toBe(true);
  });

  it("records an activity event for each person", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const created = await createGroup(actor, {
      ...BASE,
      name: "Flat",
      ownerDisplayName: "Amélie",
      participantNames: ["Blaise", "Jonas"],
    });

    const events = await getDb()
      .select({ action: activityEvents.action })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.groupId, created.id),
          eq(activityEvents.action, "participant.created"),
        ),
      );

    expect(events).toHaveLength(2);
  });

  it("lets a named person be a payer straight away", async () => {
    // The whole point of naming people at creation: no second trip through
    // the People screen before the first expense can be recorded.
    const actor = await createTestUser({ name: "Amélie" });
    const created = await createGroup(actor, {
      ...BASE,
      name: "Lisbon trip",
      ownerDisplayName: "Amélie",
      participantNames: ["Blaise"],
    });
    const access = await authorizeGroup(actor, created.id);
    const people = await listParticipants(created.id);
    const blaise = people.find((person) => person.displayName === "Blaise")!;

    await expect(
      createExpense(access, {
        description: "Pastéis",
        notes: "",
        category: "",
        amount: "500",
        currency: "EUR",
        exchangeRate: "",
        expenseDate: isoToday(),
        payers: [{ participantId: blaise.id, amount: "500" }],
        splitMethod: "equal",
        splitEntries: [
          { participantId: created.participantId },
          { participantId: blaise.id },
        ],
      }),
    ).resolves.toBeTypeOf("string");
  });

  it("keeps duplicate names, because two people really can share one", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const created = await createGroup(actor, {
      ...BASE,
      name: "Big group",
      ownerDisplayName: "Amélie",
      participantNames: ["Jonas", "Jonas"],
    });

    const people = await listParticipants(created.id);
    expect(
      people.filter((person) => person.displayName === "Jonas"),
    ).toHaveLength(2);
  });

  it("writes nothing at all when a person cannot be created", async () => {
    const actor = await createTestUser({ name: "Amélie" });

    // A NUL byte is one of the few things PostgreSQL refuses outright in a
    // text column, so it forces a failure part-way through the inserts. What
    // is being asserted is the rollback, not this particular input — the
    // schema rejects oversized and empty names long before the service.
    await expect(
      createGroup(actor, {
        ...BASE,
        name: "Doomed",
        ownerDisplayName: "Amélie",
        participantNames: ["Blaise", "Jon\u0000as"],
      }),
    ).rejects.toThrow();

    const db = getDb();
    expect(
      await db.select().from(groups).where(eq(groups.name, "Doomed")),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(participants)
        .where(eq(participants.displayName, "Blaise")),
    ).toHaveLength(0);
  });
});

/**
 * Deletion, which has to reach every table that names the group.
 *
 * A group with any history at all was once undeletable: the cascade into
 * participants tripped the `ON DELETE restrict` on expense_payers,
 * expense_shares and settlements before the cascade into expenses had cleared
 * them. Those constraints are now deferred to commit time, so the whole graph
 * goes at once. An empty group always deleted cleanly, which is exactly why
 * this survived so long — so both fixtures here record real history.
 */
describe("deleteGroup", () => {
  it("deletes a group that has expenses and settlements", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const group = await createTestGroup(actor, { name: "Voyage Paris" });
    const blaise = await addTestParticipant(group.groupId, "Blaise");

    await createExpense(group.access, {
      description: "Dîner",
      notes: "",
      category: "Food",
      amount: "5000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "5000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
      ],
    });

    await createSettlement(group.access, {
      fromParticipantId: blaise,
      toParticipantId: group.ownerParticipantId,
      amount: "2500",
      currency: "EUR",
      exchangeRate: "",
      settledOn: isoToday(),
      notes: "",
    });

    await deleteGroup(group.access);

    const db = getDb();
    expect(
      await db.select().from(groups).where(eq(groups.id, group.groupId)),
    ).toHaveLength(0);

    // Nothing may outlive the group it belonged to.
    expect(
      await db
        .select()
        .from(participants)
        .where(eq(participants.groupId, group.groupId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(expenses)
        .where(eq(expenses.groupId, group.groupId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(settlements)
        .where(eq(settlements.groupId, group.groupId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(expenseShares)
        .where(eq(expenseShares.participantId, blaise)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(expensePayers)
        .where(eq(expensePayers.participantId, group.ownerParticipantId)),
    ).toHaveLength(0);
  });

  it("still refuses to delete a participant named on an expense", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const group = await createTestGroup(actor);
    const blaise = await addTestParticipant(group.groupId, "Blaise");

    await createExpense(group.access, {
      description: "Taxi",
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

    // Deferring the check must not weaken it: a balance may never be rewritten
    // by deleting one of the people it is computed from. Removing someone from
    // a live group is a soft delete precisely because this stays impossible.
    const db = getDb();
    await expect(
      db.delete(participants).where(eq(participants.id, blaise)),
    ).rejects.toThrow();
  });
});
