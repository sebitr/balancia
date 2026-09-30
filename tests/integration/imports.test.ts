import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { expenses, importRows, settlements } from "@/lib/db/schema";
import {
  CREATE_PARTICIPANT,
  ImportError,
  commitImportRun,
  fingerprintRow,
  saveParticipantMapping,
  stageImport,
  type ImportPreview,
} from "@/modules/imports/service";
import type { StagedExpense } from "@/modules/imports/types";
import { loadGroupBalances } from "@/modules/balances/service";
import { balancesSumToZero } from "@/modules/balances/engine";
import { listParticipants } from "@/modules/groups/service";
import { createTestGroup, createTestUser } from "../helpers/factories";
import {
  readSplitwiseFixture,
  splitwiseFixtures,
  splitwiseTotalBalances,
} from "../helpers/splitwise-totals";

/**
 * Splitwise import: staging, preview, commit and — the important one — retry.
 *
 * Importing the same export twice must not double anyone's balance. That is
 * the property these tests exist to protect.
 */

const fixture = (name: string): Buffer =>
  readFileSync(path.join(process.cwd(), "tests/fixtures/splitwise", name));

async function stageTripFixture() {
  const actor = await createTestUser();
  const group = await createTestGroup(actor, { currencyMode: "separate" });
  const preview = await stageImport(group.access, {
    name: "trip-group.csv",
    bytes: fixture("trip-group.csv"),
  });
  return { actor, group, preview };
}

function mapAllToNewParticipants(
  sourceNames: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    sourceNames.map((name) => [name, CREATE_PARTICIPANT]),
  );
}

describe("staging", () => {
  it("parses the export into a preview without writing any expense", async () => {
    const { group, preview } = await stageTripFixture();

    expect(preview.expenseCount).toBe(4);
    expect(preview.settlementCount).toBe(1);
    expect(preview.currencies).toEqual(["EUR"]);
    expect(preview.sourceParticipants).toEqual(["Ada", "Blaise", "Grace"]);

    const db = getDb();
    const written = await db
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, group.groupId));
    expect(written).toHaveLength(0);
  });

  it("suggests a mapping for names that already match a participant", async () => {
    const actor = await createTestUser({ name: "Ada" });
    const group = await createTestGroup(actor);
    const preview = await stageImport(group.access, {
      name: "trip-group.csv",
      bytes: fixture("trip-group.csv"),
    });

    // The owner participant is named "Ada", so the importer should spot it.
    expect(preview.suggestedMapping.Ada).toBe(group.ownerParticipantId);
    expect(preview.suggestedMapping.Blaise).toBeUndefined();
  });

  it("rejects a file that is not a Splitwise export", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);

    await expect(
      stageImport(group.access, {
        name: "notes.csv",
        bytes: Buffer.from("hello,world\n1,2\n"),
      }),
    ).rejects.toThrow(ImportError);
  });

  it("rejects an empty file", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    await expect(
      stageImport(group.access, { name: "empty.csv", bytes: Buffer.alloc(0) }),
    ).rejects.toThrow(ImportError);
  });
});

describe("committing", () => {
  it("creates participants, expenses and settlements in one go", async () => {
    const { group, preview } = await stageTripFixture();

    await saveParticipantMapping(
      group.access,
      preview.importRunId,
      mapAllToNewParticipants(preview.sourceParticipants),
    );
    const report = await commitImportRun(preview.importRunId, group.groupId);

    expect(report.imported).toBe(5);
    expect(report.failed).toBe(0);
    expect(report.participantsCreated).toBe(3);

    const db = getDb();
    const importedExpenses = await db
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, group.groupId));
    const importedSettlements = await db
      .select()
      .from(settlements)
      .where(eq(settlements.groupId, group.groupId));

    expect(importedExpenses).toHaveLength(4);
    expect(importedSettlements).toHaveLength(1);
  });

  it("produces balances that still sum to zero", async () => {
    const { group, preview } = await stageTripFixture();
    await saveParticipantMapping(
      group.access,
      preview.importRunId,
      mapAllToNewParticipants(preview.sourceParticipants),
    );
    await commitImportRun(preview.importRunId, group.groupId);

    const balances = await loadGroupBalances(group.access);
    for (const entry of balances.currencies) {
      expect(balancesSumToZero(entry.balances)).toBe(true);
    }
  });

  // The whole path — adapter, mapping, the settlement's from and to columns,
  // the balance service — has to land where Splitwise says the group ended.
  // A payment written the wrong way round still sums to zero, so the check
  // above cannot see it; the file's own Total balance row can.
  it.each(splitwiseFixtures())(
    "lands %s on the file's own Total balance row",
    async (name) => {
      const actor = await createTestUser();
      const group = await createTestGroup(actor, { currencyMode: "separate" });
      const preview = await stageImport(group.access, {
        name,
        bytes: Buffer.from(readSplitwiseFixture(name)),
      });
      await saveParticipantMapping(
        group.access,
        preview.importRunId,
        mapAllToNewParticipants(preview.sourceParticipants),
      );
      const report = await commitImportRun(preview.importRunId, group.groupId);
      expect(report.failed).toBe(0);

      const balances = await loadGroupBalances(group.access);
      const imported = new Set(preview.sourceParticipants);
      const landed = Object.fromEntries(
        balances.currencies.flatMap((entry) =>
          entry.balances.flatMap((balance) => {
            const person = balances.participantNames.get(balance.participantId);
            // The group's owner is not in the file and stays on zero.
            return person && imported.has(person)
              ? [[`${entry.currency}|${person}`, balance.amount]]
              : [];
          }),
        ),
      );

      expect(landed).toEqual(splitwiseTotalBalances(name));
    },
  );

  it("maps a source name onto an existing participant when asked", async () => {
    const actor = await createTestUser({ name: "Ada" });
    const group = await createTestGroup(actor);
    const preview = await stageImport(group.access, {
      name: "trip-group.csv",
      bytes: fixture("trip-group.csv"),
    });

    await saveParticipantMapping(group.access, preview.importRunId, {
      Ada: group.ownerParticipantId,
      Blaise: CREATE_PARTICIPANT,
      Grace: CREATE_PARTICIPANT,
    });
    const report = await commitImportRun(preview.importRunId, group.groupId);

    expect(report.participantsCreated).toBe(2);
    const people = await listParticipants(group.groupId);
    // Owner + two created, not four.
    expect(people).toHaveLength(3);
  });

  it("refuses a mapping that points at another group's participant", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, { name: "Mine" });
    const otherGroup = await createTestGroup(actor, { name: "Theirs" });
    const preview = await stageImport(group.access, {
      name: "trip-group.csv",
      bytes: fixture("trip-group.csv"),
    });

    await saveParticipantMapping(group.access, preview.importRunId, {
      Ada: otherGroup.ownerParticipantId,
      Blaise: CREATE_PARTICIPANT,
      Grace: CREATE_PARTICIPANT,
    });

    await expect(
      commitImportRun(preview.importRunId, group.groupId),
    ).rejects.toThrow(/another group/);
  });
});

describe("retry safety", () => {
  it("importing the same file twice does not duplicate anything", async () => {
    const { group, preview } = await stageTripFixture();
    await saveParticipantMapping(
      group.access,
      preview.importRunId,
      mapAllToNewParticipants(preview.sourceParticipants),
    );
    const first = await commitImportRun(preview.importRunId, group.groupId);
    expect(first.imported).toBe(5);

    const balancesAfterFirst = await loadGroupBalances(group.access);

    // Upload the very same export again.
    const secondPreview = await stageImport(group.access, {
      name: "trip-group.csv",
      bytes: fixture("trip-group.csv"),
    });
    // Every row is recognised as already imported.
    expect(secondPreview.duplicateCount).toBe(5);

    await saveParticipantMapping(
      group.access,
      secondPreview.importRunId,
      Object.fromEntries(
        secondPreview.sourceParticipants.map((name) => [
          name,
          secondPreview.suggestedMapping[name] ?? CREATE_PARTICIPANT,
        ]),
      ),
    );
    const second = await commitImportRun(
      secondPreview.importRunId,
      group.groupId,
    );

    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(5);

    const db = getDb();
    const allExpenses = await db
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, group.groupId));
    expect(allExpenses).toHaveLength(4);

    // Balances are untouched by the second import.
    const balancesAfterSecond = await loadGroupBalances(group.access);
    expect(
      balancesAfterSecond.currencies[0].balances.map((b) => b.amount),
    ).toEqual(balancesAfterFirst.currencies[0].balances.map((b) => b.amount));
  });

  it("re-committing a finished run is a no-op", async () => {
    const { group, preview } = await stageTripFixture();
    await saveParticipantMapping(
      group.access,
      preview.importRunId,
      mapAllToNewParticipants(preview.sourceParticipants),
    );
    await commitImportRun(preview.importRunId, group.groupId);

    // A worker retrying the same job must not import twice.
    const again = await commitImportRun(preview.importRunId, group.groupId);
    expect(again.imported).toBe(0);

    const db = getDb();
    const allExpenses = await db
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, group.groupId));
    expect(allExpenses).toHaveLength(4);
  });

  it("marks duplicate rows in the staging table so the preview can explain them", async () => {
    const { group, preview } = await stageTripFixture();
    await saveParticipantMapping(
      group.access,
      preview.importRunId,
      mapAllToNewParticipants(preview.sourceParticipants),
    );
    await commitImportRun(preview.importRunId, group.groupId);

    const secondPreview = await stageImport(group.access, {
      name: "trip-group.csv",
      bytes: fixture("trip-group.csv"),
    });

    const db = getDb();
    const rows = await db
      .select()
      .from(importRows)
      .where(eq(importRows.importRunId, secondPreview.importRunId));

    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.status === "skipped_duplicate")).toBe(true);
  });
});

// Until the importer recognised "Bob paid Carol" under Payment as a payment,
// it wrote that line as an expense, and a group imported then holds it under an
// expense's fingerprint. The same file imported now reads the line as a
// payment, whose fingerprint is a different one — so unless the old one is
// known as well, the repayment goes in a second time beside the expense and
// Carol is paid back twice.
describe("a payment an older import took for an expense", () => {
  // Spelled out rather than taken from the adapter, because the fingerprint
  // this expense was stored under is the thing being tested.
  const olderReading: StagedExpense = {
    kind: "expense",
    description: "Bob paid Carol",
    category: "Payment",
    date: "2025-05-17",
    amount: "1000",
    currency: "USD",
    payers: [{ sourceName: "Bob", amount: "1000" }],
    shares: [{ sourceName: "Carol", amount: "1000" }],
  };

  async function newGroup() {
    const actor = await createTestUser();
    return createTestGroup(actor, { currencyMode: "separate" });
  }
  type Group = Awaited<ReturnType<typeof newGroup>>;

  function stageNow(group: Group) {
    return stageImport(group.access, {
      name: "bob-paid-carol.csv",
      bytes: fixture("bob-paid-carol.csv"),
    });
  }

  /** Stages the file the way the importer staged it before. */
  async function stageAsBefore(group: Group) {
    const preview = await stageNow(group);
    const db = getDb();
    const updated = await db
      .update(importRows)
      .set({
        kind: "expense",
        staged: olderReading,
        fingerprint: fingerprintRow(group.groupId, olderReading),
      })
      .where(
        and(
          eq(importRows.importRunId, preview.importRunId),
          eq(importRows.kind, "settlement"),
        ),
      )
      .returning({ id: importRows.id });
    expect(updated).toHaveLength(1);
    return preview;
  }

  /** Commits onto whoever of the file's people the group already has. */
  async function commit(group: Group, preview: ImportPreview) {
    const people = new Map(
      (await listParticipants(group.groupId)).map((person) => [
        person.displayName,
        person.id,
      ]),
    );
    await saveParticipantMapping(
      group.access,
      preview.importRunId,
      Object.fromEntries(
        preview.sourceParticipants.map((name) => [
          name,
          people.get(name) ?? CREATE_PARTICIPANT,
        ]),
      ),
    );
    return commitImportRun(preview.importRunId, group.groupId);
  }

  async function countEntries(group: Group) {
    const db = getDb();
    const [expenseRows, settlementRows] = await Promise.all([
      db.select().from(expenses).where(eq(expenses.groupId, group.groupId)),
      db
        .select()
        .from(settlements)
        .where(eq(settlements.groupId, group.groupId)),
    ]);
    return {
      expenses: expenseRows.length,
      settlements: settlementRows.length,
    };
  }

  it("is recognised in the preview and not written again", async () => {
    const group = await newGroup();
    const older = await commit(group, await stageAsBefore(group));
    expect(older.imported).toBe(7);
    expect(await countEntries(group)).toEqual({ expenses: 7, settlements: 0 });
    const balancesBefore = await loadGroupBalances(group.access);

    const preview = await stageNow(group);
    expect(preview.settlementCount).toBe(1);
    expect(preview.duplicateCount).toBe(7);

    const report = await commit(group, preview);
    expect(report.imported).toBe(0);
    expect(report.skipped).toBe(7);
    expect(await countEntries(group)).toEqual({ expenses: 7, settlements: 0 });
    expect(await loadGroupBalances(group.access)).toEqual(balancesBefore);
  });

  it("is not written again when both were staged before either committed", async () => {
    // The preview found nothing to skip, so it is the commit that has to.
    const group = await newGroup();
    const older = await stageAsBefore(group);
    const newer = await stageNow(group);
    expect(newer.duplicateCount).toBe(0);

    expect((await commit(group, older)).imported).toBe(7);
    const report = await commit(group, newer);

    expect(report.imported).toBe(0);
    expect(report.skipped).toBe(7);
    expect(await countEntries(group)).toEqual({ expenses: 7, settlements: 0 });
  });

  it("imports as a payment into a group that never had the file", async () => {
    const group = await newGroup();
    const report = await commit(group, await stageNow(group));
    expect(report.imported).toBe(7);
    expect(await countEntries(group)).toEqual({ expenses: 6, settlements: 1 });
    // 290.00 went through the file, and 10.00 of it was Bob paying Carol
    // back: the group spent 280.00.
    const balances = await loadGroupBalances(group.access);
    expect(balances.totalSpend.get("USD")).toBe(28000n);
  });
});
