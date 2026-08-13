import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { expenseCategoryMappings } from "@/lib/db/schema";
import { createExpense, updateExpense } from "@/modules/expenses/service";
import {
  loadMappings,
  recordCategoryChoice,
} from "@/modules/categorization/service";
import { classifyTransactionSync } from "@/modules/categorization";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * Learned mappings against real PostgreSQL.
 *
 * The pure learning rules are unit-tested; what needs a database is the part
 * the schema enforces — one row per merchant per owner, the two scopes kept
 * apart, and a correction committing with the expense that made it.
 */

async function addExpense(
  group: Awaited<ReturnType<typeof createTestGroup>>,
  other: string,
  overrides: { description: string; category: string },
): Promise<string> {
  return createExpense(group.access, {
    description: overrides.description,
    notes: "",
    category: overrides.category,
    amount: "3000",
    currency: "EUR",
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: group.ownerParticipantId, amount: "3000" }],
    splitMethod: "equal",
    splitEntries: [
      { participantId: group.ownerParticipantId },
      { participantId: other },
    ],
  });
}

describe("recording a category choice", () => {
  it("learns from the expense that taught it, in both scopes", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const other = await addTestParticipant(group.groupId, "Blaise");

    await addExpense(group, other, {
      description: "MIGROS 1234",
      category: "restaurants",
    });

    const mappings = await loadMappings(group.access);
    expect(mappings).toHaveLength(2);
    expect(new Set(mappings.map((mapping) => mapping.scope))).toEqual(
      new Set(["group", "user"]),
    );
    for (const mapping of mappings) {
      expect(mapping.normalizedMerchant).toBe("migros");
      expect(mapping.category).toBe("restaurants");
      expect(mapping.correctionCount).toBe(1);
    }
  });

  it("makes the next similar expense follow the correction", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const other = await addTestParticipant(group.groupId, "Blaise");

    // Without a mapping the seed rules answer "groceries".
    expect(
      classifyTransactionSync({ description: "MIGROS 5678" }).category,
    ).toBe("groceries");

    await addExpense(group, other, {
      description: "MIGROS 1234",
      category: "restaurants",
    });

    const mappings = await loadMappings(group.access);
    const result = classifyTransactionSync(
      { description: "MIGROS 5678" },
      { mappings },
    );
    expect(result.category).toBe("restaurants");
    expect(result.source).toBe("learned_mapping");
  });

  it("deepens a confirmed mapping instead of duplicating it", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const other = await addTestParticipant(group.groupId, "Blaise");

    await addExpense(group, other, {
      description: "CARREFOUR MARKET",
      category: "groceries",
    });
    await addExpense(group, other, {
      description: "CARREFOUR MARKET PARIS",
      category: "groceries",
    });

    const db = getDb();
    const rows = await db
      .select()
      .from(expenseCategoryMappings)
      .where(
        and(
          eq(expenseCategoryMappings.scope, "group"),
          eq(expenseCategoryMappings.groupId, group.groupId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].correctionCount).toBe(2);
    expect(rows[0].conflictCount).toBe(0);
  });

  it("replaces a contradicted mapping and records the conflict", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const other = await addTestParticipant(group.groupId, "Blaise");

    const expenseId = await addExpense(group, other, {
      description: "MANOR",
      category: "shopping",
    });

    await updateExpense(group.access, expenseId, {
      description: "MANOR",
      notes: "",
      category: "groceries",
      amount: "3000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "3000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: other },
      ],
    });

    const mappings = await loadMappings(group.access);
    const groupMapping = mappings.find((mapping) => mapping.scope === "group");
    expect(groupMapping?.category).toBe("groceries");
    expect(groupMapping?.correctionCount).toBe(1);
    expect(groupMapping?.conflictCount).toBe(1);
  });

  it("keeps one group's habits out of another's", async () => {
    const actor = await createTestUser();
    const first = await createTestGroup(actor, { name: "Flatshare" });
    const second = await createTestGroup(actor, { name: "Trip" });
    const other = await addTestParticipant(first.groupId, "Blaise");

    await addExpense(first, other, {
      description: "MIGROS 1234",
      category: "restaurants",
    });

    const mappings = await loadMappings(second.access);
    // The other group's mapping is absent; the same person's own is not,
    // because a user-scoped habit follows them.
    expect(mappings.map((mapping) => mapping.scope)).toEqual(["user"]);
  });

  it("ignores a category that is not one of ours", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const other = await addTestParticipant(group.groupId, "Blaise");

    // What a Splitwise import produces: a free-text label, not a category ID.
    await addExpense(group, other, {
      description: "MIGROS 1234",
      category: "Général",
    });

    expect(await loadMappings(group.access)).toEqual([]);
  });

  it("learns nothing from a merchant that normalizes to nothing", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);

    await recordCategoryChoice(group.access, {
      merchant: "PAYPAL",
      category: "shopping",
    });
    expect(await loadMappings(group.access)).toEqual([]);
  });

  it("does not learn the fallback category", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);

    await recordCategoryChoice(group.access, {
      merchant: "SOMETHING ODD",
      category: "other",
    });
    expect(await loadMappings(group.access)).toEqual([]);
  });
});
