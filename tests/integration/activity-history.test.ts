import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { activityEvents, groups } from "@/lib/db/schema";
import {
  listGroupActivity,
  namesInActivity,
  type ActivityEntry,
} from "@/modules/activity/service";
import {
  convertExpenseToSettlement,
  convertSettlementToExpense,
} from "@/modules/expenses/convert";
import {
  createExpense,
  deleteExpense,
  updateExpense,
} from "@/modules/expenses/service";
import {
  setGroupArchived,
  updateGroup,
  updateParticipant,
} from "@/modules/groups/service";
import {
  createRecurringExpense,
  setRecurringPaused,
} from "@/modules/recurring/service";
import {
  createSettlement,
  deleteSettlement,
  restoreSettlement,
  updateSettlement,
} from "@/modules/settlements/service";
import { eq } from "drizzle-orm";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * The history, as a person reads it.
 *
 * The feed was a list of rows exactly as the services had written them, and so
 * it told the truth badly: turning an expense into a repayment showed as an
 * unrelated deletion and an unrelated repayment at one instant, in no
 * particular order; an edit said it had edited something and nothing of what;
 * a deleted repayment named nobody; a group taken out of the archive said it
 * had been archived. Each of these starts at the write, which has to record
 * what the line will need, and ends at the read, which has to put the rows
 * back together.
 */

async function setup() {
  const actor = await createTestUser({ name: "Ada" });
  const group = await createTestGroup(actor);
  const blaise = await addTestParticipant(group.groupId, "Blaise");

  const expenseInput = (description = "Dinner", amount = "3000") => ({
    description,
    notes: "",
    category: "",
    amount,
    currency: "EUR",
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: group.ownerParticipantId, amount }],
    splitMethod: "equal" as const,
    splitEntries: [
      { participantId: group.ownerParticipantId },
      { participantId: blaise },
    ],
  });
  const settlementInput = (amount = "1500") => ({
    fromParticipantId: blaise,
    toParticipantId: group.ownerParticipantId,
    amount,
    currency: "EUR",
    exchangeRate: "",
    settledOn: isoToday(),
    notes: "",
  });

  return { actor, group, blaise, expenseInput, settlementInput };
}

const actions = (entries: readonly ActivityEntry[]) =>
  entries.map((entry) => entry.action);

describe("a change of type, in the history", () => {
  it("is one entry, with the deleted one folded into it", async () => {
    const { group, blaise, expenseInput, settlementInput } = await setup();
    const id = await createExpense(group.access, expenseInput());

    const settlementId = await convertExpenseToSettlement(
      group.access,
      id,
      settlementInput(),
    );

    const feed = await listGroupActivity(group.groupId);
    expect(actions(feed)).toEqual(["settlement.created", "expense.created"]);
    expect(feed[0]).toMatchObject({
      entityId: settlementId,
      replaces: {
        action: "expense.deleted",
        entityId: id,
        metadata: {
          description: "Dinner",
          amount: "3000",
          replacedBy: settlementId,
        },
      },
    });

    // And its line can name both ends, the folded deletion's people included.
    const names = await namesInActivity(group.groupId, feed);
    expect(names.get(blaise)).toBe("Blaise");
    expect(names.get(group.ownerParticipantId)).toBe("Ada");
  });

  it("is folded the same way back, from a repayment into an expense", async () => {
    const { group, expenseInput, settlementInput } = await setup();
    const id = await createSettlement(group.access, settlementInput("2500"));

    const expenseId = await convertSettlementToExpense(
      group.access,
      id,
      expenseInput("Taxi", "2500"),
    );

    const feed = await listGroupActivity(group.groupId);
    expect(actions(feed)).toEqual(["expense.created", "settlement.created"]);
    expect(feed[0]).toMatchObject({
      entityId: expenseId,
      replaces: {
        action: "settlement.deleted",
        entityId: id,
        metadata: { amount: "2500", replacedBy: expenseId },
      },
    });
  });

  it("keeps the order the rows were written in, within one transaction", async () => {
    const { group, expenseInput, settlementInput } = await setup();
    const id = await createExpense(group.access, expenseInput());
    await convertExpenseToSettlement(group.access, id, settlementInput());

    const raw = await listGroupActivity(group.groupId, { raw: true });

    // Newest first: the deletion was written after the repayment, and the log
    // used to give both the instant the transaction began.
    expect(actions(raw)).toEqual([
      "expense.deleted",
      "settlement.created",
      "expense.created",
    ]);
    expect(raw[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(
      raw[1]!.createdAt.getTime(),
    );
  });

  it("is still one entry when the page ends between its two halves", async () => {
    const { group, expenseInput, settlementInput } = await setup();
    const id = await createExpense(group.access, expenseInput());
    await convertExpenseToSettlement(group.access, id, settlementInput());

    // Two rows of the three would cut the pair in half.
    const feed = await listGroupActivity(group.groupId, { limit: 1 });

    expect(actions(feed)).toEqual(["settlement.created"]);
    expect(feed[0]!.replaces?.action).toBe("expense.deleted");
  });

  it("folds one written before the deletion named its replacement", async () => {
    const { group, expenseInput, settlementInput } = await setup();
    const id = await createExpense(group.access, expenseInput());
    await convertExpenseToSettlement(group.access, id, settlementInput());

    // Take `replacedBy` off the stored deletion, as if written by an older
    // build; the pair is then known only by its instant and its author.
    const db = getDb();
    const raw = await listGroupActivity(group.groupId, { raw: true });
    const deletion = raw.find((row) => row.action === "expense.deleted")!;
    await db
      .update(activityEvents)
      .set({
        metadata: Object.fromEntries(
          Object.entries(deletion.metadata!).filter(
            ([key]) => key !== "replacedBy",
          ),
        ),
      })
      .where(eq(activityEvents.id, deletion.id));
    // Both rows at one instant, as every older transaction wrote them.
    const repayment = raw.find((row) => row.action === "settlement.created")!;
    await db
      .update(activityEvents)
      .set({ createdAt: deletion.createdAt })
      .where(eq(activityEvents.id, repayment.id));

    const feed = await listGroupActivity(group.groupId);

    expect(actions(feed)).toEqual(["settlement.created", "expense.created"]);
    expect(feed[0]!.replaces?.entityId).toBe(id);
  });

  it("is left raw for the mobile API, which words events itself", async () => {
    const { group, expenseInput, settlementInput } = await setup();
    const id = await createExpense(group.access, expenseInput());
    await convertExpenseToSettlement(group.access, id, settlementInput());

    const raw = await listGroupActivity(group.groupId, { raw: true });

    expect(raw).toHaveLength(3);
    expect(raw.every((row) => row.replaces === undefined)).toBe(true);
    expect(
      raw.every(
        (row) => !Object.prototype.hasOwnProperty.call(row, "actorUserId"),
      ),
    ).toBe(true);
  });
});

describe("what an edit records", () => {
  it("says which parts moved, and what the figure and the name were", async () => {
    const { group, expenseInput } = await setup();
    const id = await createExpense(group.access, expenseInput());

    await updateExpense(group.access, id, expenseInput("Dinner", "3600"));

    const [edit] = await listGroupActivity(group.groupId);
    expect(edit!.action).toBe("expense.updated");
    expect(edit!.metadata).toMatchObject({
      description: "Dinner",
      amount: "3600",
      direction: "out",
      // Not "who paid" or "the split": the one payer and the equal split
      // follow the total on their own, and the person only changed the figure.
      changed: ["amount"],
      before: { description: "Dinner", amount: "3000", currency: "EUR" },
    });
  });

  it("records a rename on its own, and a save that changed nothing as no change", async () => {
    const { group, expenseInput } = await setup();
    const id = await createExpense(group.access, expenseInput());

    await updateExpense(group.access, id, expenseInput("Dinner at Luigi's"));
    await updateExpense(group.access, id, expenseInput("Dinner at Luigi's"));

    const [same, renamed] = await listGroupActivity(group.groupId);
    expect(renamed!.metadata).toMatchObject({
      changed: ["description"],
      before: { description: "Dinner" },
    });
    expect(same!.metadata).toMatchObject({ changed: [] });
  });

  it("never records the notes themselves", async () => {
    const { group, expenseInput } = await setup();
    const id = await createExpense(group.access, expenseInput());

    await updateExpense(group.access, id, {
      ...expenseInput(),
      notes: "the cousins are not to know",
    });

    const [edit] = await listGroupActivity(group.groupId);
    expect(edit!.metadata).toMatchObject({ changed: ["notes"] });
    expect(JSON.stringify(edit!.metadata)).not.toContain("cousins");
  });

  it("records the kind of entry on every expense event", async () => {
    const { group, expenseInput } = await setup();
    const id = await createExpense(group.access, {
      ...expenseInput("Salary", "300000"),
      direction: "in",
    });
    await deleteExpense(group.access, id);

    const feed = await listGroupActivity(group.groupId);
    expect(feed.map((row) => row.metadata?.direction)).toEqual(["in", "in"]);
  });
});

describe("a repayment's events", () => {
  it("name the two people on an edit, a deletion and a restore", async () => {
    const { group, blaise, settlementInput } = await setup();
    const id = await createSettlement(group.access, settlementInput());
    await updateSettlement(group.access, id, settlementInput("2000"));
    await deleteSettlement(group.access, id);
    await restoreSettlement(group.access, id);

    const feed = await listGroupActivity(group.groupId, { raw: true });

    expect(actions(feed)).toEqual([
      "settlement.restored",
      "settlement.deleted",
      "settlement.updated",
      "settlement.created",
    ]);
    for (const row of feed) {
      expect(row.metadata).toMatchObject({
        from: blaise,
        to: group.ownerParticipantId,
      });
    }
  });

  it("keeps what an edited repayment was, only when the figure moved", async () => {
    const { group, settlementInput } = await setup();
    const id = await createSettlement(group.access, settlementInput("1500"));

    await updateSettlement(group.access, id, settlementInput("2000"));
    await updateSettlement(group.access, id, settlementInput("2000"));

    const [again, moved] = await listGroupActivity(group.groupId);
    expect(moved!.metadata).toMatchObject({
      amount: "2000",
      before: { amount: "1500", currency: "EUR" },
    });
    expect(again!.metadata).not.toHaveProperty("before");
  });

  it("are given their people when they were written without them", async () => {
    const { group, blaise, settlementInput } = await setup();
    const id = await createSettlement(group.access, settlementInput());
    await deleteSettlement(group.access, id);

    // As an older build wrote the deletion: an amount, and nobody.
    const db = getDb();
    const raw = await listGroupActivity(group.groupId, { raw: true });
    const deletion = raw.find((row) => row.action === "settlement.deleted")!;
    await db
      .update(activityEvents)
      .set({ metadata: { amount: "1500", currency: "EUR" } })
      .where(eq(activityEvents.id, deletion.id));

    const [read] = await listGroupActivity(group.groupId);

    expect(read!.metadata).toMatchObject({
      from: blaise,
      to: group.ownerParticipantId,
    });
    // The mobile API's rows are as written.
    const [stored] = await listGroupActivity(group.groupId, { raw: true });
    expect(stored!.metadata).not.toHaveProperty("from");
  });
});

describe("who is named", () => {
  it("looks up the person behind an import, whose event kept an account and no seat", async () => {
    const { actor, group } = await setup();
    await getDb()
      .insert(activityEvents)
      .values({
        groupId: group.groupId,
        action: "import.completed",
        entityType: "import_run",
        entityId: randomUUID(),
        actorType: "user",
        actorUserId: actor.userId,
        actorLabel: "Import",
        metadata: { fileName: "trip.csv", imported: 3, skipped: 0, failed: 0 },
      });

    const [run] = await listGroupActivity(group.groupId);

    expect(run!.actorParticipantId).toBe(group.ownerParticipantId);
    const names = await namesInActivity(group.groupId, [run!]);
    expect(names.get(group.ownerParticipantId)).toBe("Ada");
  });

  it("leaves an import nobody started as the system's", async () => {
    const { group } = await setup();
    await getDb()
      .insert(activityEvents)
      .values({
        groupId: group.groupId,
        action: "import.completed",
        entityType: "import_run",
        entityId: randomUUID(),
        actorType: "system",
        actorLabel: "Import",
        metadata: { fileName: "trip.csv", imported: 3 },
      });

    const [run] = await listGroupActivity(group.groupId);

    expect(run!.actorParticipantId).toBeNull();
  });

  it("includes the actor, so a feed can print the name the group has for them", async () => {
    const { group, expenseInput } = await setup();
    await createExpense(group.access, expenseInput());

    const feed = await listGroupActivity(group.groupId);
    const names = await namesInActivity(group.groupId, feed);

    expect(names.get(group.ownerParticipantId)).toBe("Ada");
  });
});

describe("the group's and the people's events", () => {
  it("records what a group edit changed, and the name it replaced", async () => {
    const { group } = await setup();
    const base = { description: "", timezone: "UTC" };

    await updateGroup(group.access, { ...base, name: "Lisbon" });
    await updateGroup(group.access, { ...base, name: "Lisbon 2027" });
    await updateGroup(group.access, {
      ...base,
      name: "Lisbon 2027",
      timezone: "Europe/Lisbon",
    });

    const [zone, renamed, first] = await listGroupActivity(group.groupId);
    expect(first!.metadata).toMatchObject({
      changed: ["name"],
      previousName: "Test group",
    });
    expect(renamed!.metadata).toMatchObject({
      changed: ["name"],
      previousName: "Lisbon",
    });
    expect(zone!.metadata).toMatchObject({ changed: ["timezone"] });
    expect(zone!.metadata).not.toHaveProperty("previousName");
  });

  it("leaves the icon alone when a form says nothing about it", async () => {
    const { group } = await setup();
    await getDb()
      .update(groups)
      .set({ icon: "plane" })
      .where(eq(groups.id, group.groupId));

    await updateGroup(group.access, {
      name: "Test group",
      description: "",
      timezone: "UTC",
    });

    const [saved] = await listGroupActivity(group.groupId);
    expect(saved!.metadata).toMatchObject({ changed: [] });
  });

  it("says a group was taken out of the archive, not that it was archived", async () => {
    const { group } = await setup();

    await setGroupArchived(group.access, true);
    await setGroupArchived(group.access, false);

    const feed = await listGroupActivity(group.groupId);
    expect(feed.map((row) => row.metadata?.archived)).toEqual([false, true]);
  });

  it("keeps the old name when somebody is renamed, and not when they are not", async () => {
    const { group, blaise } = await setup();

    await updateParticipant(group.access, blaise, {
      displayName: "Blaise Pascal",
    });
    await updateParticipant(group.access, blaise, {
      displayName: "Blaise Pascal",
      email: "blaise@example.test",
    });

    const [same, renamed] = await listGroupActivity(group.groupId);
    expect(renamed!.metadata).toMatchObject({
      displayName: "Blaise Pascal",
      previousName: "Blaise",
    });
    expect(same!.metadata).not.toHaveProperty("previousName");
  });

  it("names the recurring expense that was paused", async () => {
    const { group, blaise } = await setup();
    const templateId = await createRecurringExpense(group.access, {
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
      startDate: isoToday(10),
      endDate: "",
    });

    await setRecurringPaused(group.access, templateId, true);
    await setRecurringPaused(group.access, templateId, false);

    const [resumed, paused] = await listGroupActivity(group.groupId);
    expect(paused!.metadata).toMatchObject({
      description: "Rent",
      paused: true,
    });
    expect(resumed!.metadata).toMatchObject({
      description: "Rent",
      paused: false,
    });
  });
});
