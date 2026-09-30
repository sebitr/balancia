import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import {
  expensePayers,
  expenses,
  importRows,
  importRuns,
  importedFingerprints,
  participants,
  settlements,
} from "@/lib/db/schema";
import {
  CREATE_PARTICIPANT,
  ImportError,
  commitImportRun,
  fingerprintRow,
  saveParticipantMapping,
  stageImport,
  type ImportPreview,
} from "@/modules/imports/service";
import type { StagedExpense, StagedRow } from "@/modules/imports/types";
import { MAX_IMPORT_BYTES } from "@/modules/imports/limits";
import { splitwiseCsvAdapter } from "@/modules/imports/splitwise-csv";
import { loadGroupBalances } from "@/modules/balances/service";
import { balancesSumToZero } from "@/modules/balances/engine";
import { listParticipants } from "@/modules/groups/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
} from "../helpers/factories";
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

  it("refuses a file over the limit with a message that names it", async () => {
    // Between the 1 MB the Server Action carries and the 10 MiB this used to
    // promise. The wizard refuses it before sending; this is the same answer
    // for a request that went around the wizard.
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const header = "Date,Description,Cost,Currency,Ada,Blaise\n";
    const line = "2026-01-01,Coffee,10.00,EUR,5.00,-5.00\n";
    const bytes = Buffer.from(header + line.repeat(40_000));
    expect(bytes.byteLength).toBeGreaterThan(MAX_IMPORT_BYTES);
    expect(bytes.byteLength).toBeLessThan(10 * 1024 * 1024);

    await expect(
      stageImport(group.access, { name: "big.csv", bytes }),
    ).rejects.toThrow(/larger than 1 MB/);
  });

  it("holds rows to what the database and the forms accept, and says so", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const longDescription = "Weekend in the Alps ".repeat(15).trim();
    const csv = [
      "Date,Description,Cost,Currency,Ada,Blaise",
      "2026-01-01,Coffee,10.00,EUR,5.00,-5.00",
      `2026-01-02,${longDescription},20.00,EUR,10.00,-10.00`,
      "2026-01-03,Yacht,99999999999999999999.00,EUR,50000000000000000000.00,-50000000000000000000.00",
      "2024-02-30,Leap,10.00,EUR,5.00,-5.00",
      "",
    ].join("\n");

    const preview = await stageImport(group.access, {
      name: "limits.csv",
      bytes: Buffer.from(csv),
    });

    expect(preview.rowsTotal).toBe(2);
    const said = preview.warnings.map((warning) => [
      warning.rowNumber,
      warning.message,
    ]);
    expect(said).toEqual(
      expect.arrayContaining([
        [3, expect.stringMatching(/Shortened a description/)],
        [4, expect.stringMatching(/too large/)],
        [5, expect.stringMatching(/unrecognised date/)],
      ]),
    );

    const db = getDb();
    const staged = await db
      .select({
        staged: importRows.staged,
        fingerprint: importRows.fingerprint,
      })
      .from(importRows)
      .where(eq(importRows.importRunId, preview.importRunId))
      .orderBy(importRows.rowNumber);
    const long = staged[1];
    expect((long.staged as { description: string }).description).toHaveLength(
      200,
    );
    // The fingerprint is the row as the file had it, so a file imported whole
    // before the text was ever shortened is still recognised on a retry.
    const original = splitwiseCsvAdapter
      .parse(csv)
      .rows.find((entry) => entry.rowNumber === 3)!.row;
    expect(long.fingerprint).toBe(fingerprintRow(group.groupId, original));
  });
});

describe("a Splitwise refund", () => {
  it("lands as income and leaves everyone where the export put them", async () => {
    // Ada paid 90 for a three-way dinner, then 30 of it came back to her.
    // Splitwise writes that as a negative cost; the columns are still each
    // person's net for the row.
    const actor = await createTestUser();
    const group = await createTestGroup(actor, { currencyMode: "separate" });
    const csv = [
      "Date,Description,Category,Cost,Currency,Ada,Blaise,Grace",
      "2026-03-01,Dinner,Dining out,90.00,EUR,60.00,-30.00,-30.00",
      "2026-03-02,Dinner refund,Dining out,-30.00,EUR,-20.00,10.00,10.00",
      "",
    ].join("\n");
    const preview = await stageImport(group.access, {
      name: "refund.csv",
      bytes: Buffer.from(csv),
    });
    await saveParticipantMapping(
      group.access,
      preview.importRunId,
      mapAllToNewParticipants(preview.sourceParticipants),
    );

    const report = await commitImportRun(preview.importRunId, group.groupId);
    expect(report).toMatchObject({ imported: 2, failed: 0 });

    const db = getDb();
    const [refund] = await db
      .select({
        direction: expenses.direction,
        amount: expenses.amount,
        category: expenses.category,
      })
      .from(expenses)
      .where(eq(expenses.description, "Dinner refund"));
    expect(refund).toEqual({
      direction: "in",
      amount: 3000n,
      category: "refunds",
    });

    const balances = await loadGroupBalances(group.access);
    const people = await listParticipants(group.groupId);
    const nameOf = new Map(people.map((p) => [p.id, p.displayName]));
    const net = Object.fromEntries(
      balances.currencies[0].balances.map((entry) => [
        nameOf.get(entry.participantId),
        entry.amount,
      ]),
    );
    expect(net).toMatchObject({ Ada: 4000n, Blaise: -2000n, Grace: -2000n });
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

    const mapping = {
      Ada: otherGroup.ownerParticipantId,
      Blaise: CREATE_PARTICIPANT,
      Grace: CREATE_PARTICIPANT,
    };

    // Refused as it is saved, so nothing is stored for a commit to act on.
    await expect(
      saveParticipantMapping(group.access, preview.importRunId, mapping),
    ).rejects.toThrow(ImportError);
    const db = getDb();
    const [stored] = await db
      .select({ participantMapping: importRuns.participantMapping })
      .from(importRuns)
      .where(eq(importRuns.id, preview.importRunId));
    expect(stored.participantMapping).toBeNull();

    // And still refused at commit, should a run hold one anyway — the worker
    // commits whatever mapping the row carries.
    await db
      .update(importRuns)
      .set({ participantMapping: mapping })
      .where(eq(importRuns.id, preview.importRunId));
    await expect(
      commitImportRun(preview.importRunId, group.groupId),
    ).rejects.toThrow(/another group/);
  });
});

describe("saving the participant mapping", () => {
  it("refuses a name the file never staged, and stores nothing", async () => {
    const { group, preview } = await stageTripFixture();

    await expect(
      saveParticipantMapping(group.access, preview.importRunId, {
        Ada: CREATE_PARTICIPANT,
        Mallory: CREATE_PARTICIPANT,
      }),
    ).rejects.toThrow(ImportError);

    const db = getDb();
    const [stored] = await db
      .select({ participantMapping: importRuns.participantMapping })
      .from(importRuns)
      .where(eq(importRuns.id, preview.importRunId));
    expect(stored.participantMapping).toBeNull();
  });

  it("refuses someone who has since left the group", async () => {
    const { group, preview } = await stageTripFixture();
    const leaver = await addTestParticipant(group.groupId, "Blaise");
    await getDb()
      .update(participants)
      .set({ removedAt: new Date() })
      .where(eq(participants.id, leaver));

    await expect(
      saveParticipantMapping(group.access, preview.importRunId, {
        Blaise: leaver,
      }),
    ).rejects.toThrow(/not in this group/);
  });
});

describe("a row the database refuses", () => {
  /**
   * Somebody who had two Splitwise accounts, both matched onto the one person
   * they are here. Nothing in the file is wrong, so the adapter stages every
   * row — but the Taxi row names both accounts, and an expense holds one share
   * per participant: PostgreSQL itself refuses it on
   * `expense_shares_expense_participant_unique`. That is a real database
   * error, raised mid-transaction, which is what used to abort the whole run.
   */
  const twoAccounts = [
    "Date,Description,Category,Cost,Currency,Ada,Ada (phone),Grace",
    "2026-03-01,Groceries,Groceries,60.00,EUR,30.00,0.00,-30.00",
    "2026-03-02,Taxi,Taxi,30.00,EUR,-10.00,20.00,-10.00",
    "2026-03-03,Museum,Entertainment,45.00,EUR,-22.50,0.00,22.50",
    "",
  ].join("\n");

  async function stageTwoAccounts() {
    const actor = await createTestUser({ name: "Ada" });
    const group = await createTestGroup(actor, { currencyMode: "separate" });
    const preview = await stageImport(group.access, {
      name: "two-accounts.csv",
      bytes: Buffer.from(twoAccounts),
    });
    await saveParticipantMapping(group.access, preview.importRunId, {
      Ada: group.ownerParticipantId,
      "Ada (phone)": group.ownerParticipantId,
      Grace: CREATE_PARTICIPANT,
    });
    return { group, preview };
  }

  it("fails alone, and the rows around it still import", async () => {
    const { group, preview } = await stageTwoAccounts();

    const report = await commitImportRun(preview.importRunId, group.groupId);

    expect(report).toMatchObject({ imported: 2, skipped: 0, failed: 1 });
    const db = getDb();
    const written = await db
      .select({ description: expenses.description })
      .from(expenses)
      .where(eq(expenses.groupId, group.groupId));
    expect(written.map((row) => row.description).sort()).toEqual([
      "Groceries",
      "Museum",
    ]);
  });

  it("records the refused row as failed, with a reason, and the run as finished", async () => {
    const { group, preview } = await stageTwoAccounts();
    await commitImportRun(preview.importRunId, group.groupId);

    const db = getDb();
    const rows = await db
      .select({
        rowNumber: importRows.rowNumber,
        status: importRows.status,
        message: importRows.message,
      })
      .from(importRows)
      .where(eq(importRows.importRunId, preview.importRunId))
      .orderBy(importRows.rowNumber);
    expect(rows.map((row) => [row.rowNumber, row.status])).toEqual([
      [2, "imported"],
      [3, "error"],
      [4, "imported"],
    ]);
    expect(rows[1].message).toBeTruthy();

    const [run] = await db
      .select({
        status: importRuns.status,
        rowsImported: importRuns.rowsImported,
        rowsFailed: importRuns.rowsFailed,
      })
      .from(importRuns)
      .where(eq(importRuns.id, preview.importRunId));
    expect(run).toEqual({
      status: "completed",
      rowsImported: 2,
      rowsFailed: 1,
    });
  });

  it("leaves nothing of the refused row behind", async () => {
    const { group, preview } = await stageTwoAccounts();
    await commitImportRun(preview.importRunId, group.groupId);

    // The payer line of the Taxi row was written before its shares were
    // refused. Rolled back with its savepoint, it cannot be orphaned — and its
    // fingerprint was never recorded, so a later import can still bring the
    // row in once the mapping is put right.
    const db = getDb();
    const payers = await db
      .select({ expenseId: expensePayers.expenseId })
      .from(expensePayers)
      .innerJoin(expenses, eq(expenses.id, expensePayers.expenseId))
      .where(eq(expenses.groupId, group.groupId));
    expect(payers).toHaveLength(2);
    const fingerprints = await db
      .select({ fingerprint: importedFingerprints.fingerprint })
      .from(importedFingerprints)
      .where(eq(importedFingerprints.groupId, group.groupId));
    expect(fingerprints).toHaveLength(2);
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

  it("is recognised in the preview when the limits drop a row before it", async () => {
    // The row too large to record is dropped before anything is fingerprinted.
    // The older readings were once taken from every parsed row, the dropped
    // one included, and matched up by position with the rows kept — so the
    // payment was checked against the row before it, and the preview offered
    // to import a payment the commit then skipped.
    const bytes = Buffer.from(
      [
        "Date,Description,Category,Cost,Currency,Bob,Carol",
        "2025-05-16,Yacht,General,99999999999999999999.00,USD,50000000000000000000.00,-50000000000000000000.00",
        "2025-05-17,Bob paid Carol,Payment,10.00,USD,10.00,-10.00",
        "",
      ].join("\n"),
    );
    const stage = (group: Group) =>
      stageImport(group.access, { name: "payment.csv", bytes });

    const group = await newGroup();
    const older = await stage(group);
    expect(older.rowsTotal).toBe(1);
    await getDb()
      .update(importRows)
      .set({
        kind: "expense",
        staged: olderReading,
        fingerprint: fingerprintRow(group.groupId, olderReading),
      })
      .where(eq(importRows.importRunId, older.importRunId));
    expect((await commit(group, older)).imported).toBe(1);

    const preview = await stage(group);
    expect(preview.duplicateCount).toBe(1);
    expect((await commit(group, preview)).imported).toBe(0);
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

// A file can hold the same line twice and mean it: two coffees at 6.00 on one
// morning, split the same way, or the same repayment made twice in a day.
// Nothing tells the two apart but that there are two of them, and the importer
// used to fingerprint them alike — so the second was taken for the first,
// already imported, and never written. The report said "skipped" and the
// group's balances stopped matching the file.
describe("a line that appears twice in one file", () => {
  async function newGroup() {
    const actor = await createTestUser();
    return createTestGroup(actor, { currencyMode: "separate" });
  }
  type Group = Awaited<ReturnType<typeof newGroup>>;

  function stage(group: Group, name: string, bytes: Buffer = fixture(name)) {
    return stageImport(group.access, { name, bytes });
  }

  /**
   * Stages a file the way the importer did before it counted repeats: every
   * copy of a line under the one fingerprint of its first. With `asExpenses`,
   * a "Blaise paid Ada" line is staged as the expense it was read as before
   * the importer knew a payment by its category, too.
   */
  async function stageAsBefore(
    group: Group,
    name: string,
    options: { asExpenses?: boolean; bytes?: Buffer } = {},
  ) {
    const preview = await stage(group, name, options.bytes);
    const db = getDb();
    const rows = await db
      .select({ id: importRows.id, staged: importRows.staged })
      .from(importRows)
      .where(eq(importRows.importRunId, preview.importRunId));
    for (const row of rows) {
      const staged = row.staged as StagedRow;
      const before =
        options.asExpenses &&
        staged.kind === "settlement" &&
        staged.formerlyReadAs
          ? staged.formerlyReadAs
          : staged;
      await db
        .update(importRows)
        .set({
          kind: before.kind,
          staged: before,
          fingerprint: fingerprintRow(group.groupId, before),
        })
        .where(eq(importRows.id, row.id));
    }
    return preview;
  }

  /** Commits, matching the file's people onto the group's by name. */
  async function commit(group: Group, preview: ImportPreview) {
    await saveParticipantMapping(
      group.access,
      preview.importRunId,
      Object.fromEntries(
        preview.sourceParticipants.map((name) => [
          name,
          preview.suggestedMapping[name] ?? CREATE_PARTICIPANT,
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

  /** Where the file's three people stand, keyed as the Total balance row is. */
  async function landed(group: Group) {
    const balances = await loadGroupBalances(group.access);
    const people = new Set(["Ada", "Blaise", "Grace"]);
    return Object.fromEntries(
      balances.currencies.flatMap((entry) =>
        entry.balances.flatMap((balance) => {
          const person = balances.participantNames.get(balance.participantId);
          return person && people.has(person)
            ? [[`${entry.currency}|${person}`, balance.amount]]
            : [];
        }),
      ),
    );
  }

  const total = splitwiseTotalBalances("identical-lines.csv");

  it.each(["identical-lines.csv", "identical-lines.json"])(
    "imports every line of %s, the repeats with it, and nothing on a second run",
    async (name) => {
      const group = await newGroup();

      const preview = await stage(group, name);
      expect(preview).toMatchObject({
        rowsTotal: 5,
        expenseCount: 3,
        settlementCount: 2,
        duplicateCount: 0,
      });
      const first = await commit(group, preview);
      expect(first).toMatchObject({ imported: 5, skipped: 0, failed: 0 });
      expect(await countEntries(group)).toEqual({
        expenses: 3,
        settlements: 2,
      });
      expect(await landed(group)).toEqual(total);

      const again = await stage(group, name);
      expect(again.duplicateCount).toBe(5);
      const second = await commit(group, again);
      expect(second).toMatchObject({ imported: 0, skipped: 5, failed: 0 });
      expect(await countEntries(group)).toEqual({
        expenses: 3,
        settlements: 2,
      });
      expect(await landed(group)).toEqual(total);
    },
  );

  it("brings in exactly the missing copy of each line, and shows it as new first", async () => {
    const group = await newGroup();
    const older = await commit(
      group,
      await stageAsBefore(group, "identical-lines.csv"),
    );
    expect(older).toMatchObject({ imported: 3, skipped: 2 });
    expect(await countEntries(group)).toEqual({ expenses: 2, settlements: 1 });
    expect(await landed(group)).not.toEqual(total);

    const preview = await stage(group, "identical-lines.csv");
    // The second coffee (row 4) and the second payment (row 6) are counted
    // among the rows to import, not among those already imported.
    expect(preview.rowsTotal).toBe(5);
    expect(preview.duplicateCount).toBe(3);
    const staged = await getDb()
      .select({ rowNumber: importRows.rowNumber, status: importRows.status })
      .from(importRows)
      .where(eq(importRows.importRunId, preview.importRunId))
      .orderBy(importRows.rowNumber);
    expect(staged.map((row) => [row.rowNumber, row.status])).toEqual([
      [2, "skipped_duplicate"],
      [3, "skipped_duplicate"],
      [4, "pending"],
      [5, "skipped_duplicate"],
      [6, "pending"],
    ]);

    const report = await commit(group, preview);
    expect(report).toMatchObject({ imported: 2, skipped: 3, failed: 0 });
    expect(await countEntries(group)).toEqual({ expenses: 3, settlements: 2 });
    expect(await landed(group)).toEqual(total);

    const third = await commit(
      group,
      await stage(group, "identical-lines.csv"),
    );
    expect(third).toMatchObject({ imported: 0, skipped: 5 });
  });

  it("brings in the missing payment beside the expense an older import made of the first", async () => {
    // Before the importer knew "Blaise paid Ada" for a payment, it wrote the
    // first of the two as an expense and dropped the second. The first is
    // known by that expense's fingerprint; the second was never written under
    // any, so it comes in — as the payment it is.
    const group = await newGroup();
    const older = await commit(
      group,
      await stageAsBefore(group, "identical-lines.csv", { asExpenses: true }),
    );
    expect(older).toMatchObject({ imported: 3, skipped: 2 });
    expect(await countEntries(group)).toEqual({ expenses: 3, settlements: 0 });

    const preview = await stage(group, "identical-lines.csv");
    expect(preview.duplicateCount).toBe(3);
    const report = await commit(group, preview);
    expect(report).toMatchObject({ imported: 2, skipped: 3, failed: 0 });
    expect(await countEntries(group)).toEqual({ expenses: 4, settlements: 1 });
    expect(await landed(group)).toEqual(total);

    const third = await commit(
      group,
      await stage(group, "identical-lines.csv"),
    );
    expect(third).toMatchObject({ imported: 0, skipped: 5 });
  });

  it("checks each payment against its own older reading when the limits leave a row out", async () => {
    // The row too large to record is dropped before anything is fingerprinted.
    // The former fingerprints were once read off the rows as parsed, the
    // dropped one still among them, so the payment was checked against the
    // older reading of the row before it — none — and the preview offered to
    // import a payment the commit then skipped.
    const bytes = Buffer.from(
      [
        "Date,Description,Category,Cost,Currency,Ada,Blaise,Grace",
        "2026-04-01,Yacht,General,99999999999999999999.00,EUR,50000000000000000000.00,-50000000000000000000.00,0.00",
        "2026-04-02,Blaise paid Ada,Payment,5.00,EUR,-5.00,5.00,0.00",
        "",
      ].join("\n"),
    );
    const group = await newGroup();
    const older = await commit(
      group,
      await stageAsBefore(group, "payment.csv", { asExpenses: true, bytes }),
    );
    expect(older).toMatchObject({ imported: 1 });

    const preview = await stage(group, "payment.csv", bytes);
    expect(preview).toMatchObject({ rowsTotal: 1, duplicateCount: 1 });
  });

  it("restores both copies of an entry a Balancia backup holds twice", async () => {
    // Two entries of one group, told apart in the file only by their ids,
    // which the fingerprint has never read.
    const person = (id: string, name: string) => ({
      id,
      displayName: name,
      email: null,
    });
    const share = (id: string, amount: string) => ({
      participantId: id,
      amount,
    });
    const coffee = (id: string) => ({
      id,
      direction: "out",
      description: "Coffee",
      category: "restaurants",
      subcategory: "cafe",
      amount: "600",
      currency: "EUR",
      expenseDate: "2026-04-01",
      payers: [share("p-ada", "600")],
      shares: [
        share("p-ada", "200"),
        share("p-blaise", "200"),
        share("p-grace", "200"),
      ],
    });
    const repayment = (id: string) => ({
      id,
      fromParticipantId: "p-blaise",
      toParticipantId: "p-ada",
      amount: "500",
      currency: "EUR",
      settledOn: "2026-04-02",
      notes: null,
    });
    const bytes = Buffer.from(
      JSON.stringify({
        balancia: { exportVersion: 1, exportedAt: "2026-04-03T09:00:00.000Z" },
        group: { name: "Lisbon trip" },
        participants: [
          person("p-ada", "Ada"),
          person("p-blaise", "Blaise"),
          person("p-grace", "Grace"),
        ],
        expenses: [coffee("e-1"), coffee("e-2")],
        settlements: [repayment("s-1"), repayment("s-2")],
      }),
    );

    const group = await newGroup();
    const first = await commit(group, await stage(group, "backup.json", bytes));
    expect(first).toMatchObject({ imported: 4, skipped: 0, failed: 0 });
    expect(await countEntries(group)).toEqual({ expenses: 2, settlements: 2 });
    expect(await landed(group)).toEqual({
      "EUR|Ada": -200n,
      "EUR|Blaise": 600n,
      "EUR|Grace": -400n,
    });

    const second = await commit(
      group,
      await stage(group, "backup.json", bytes),
    );
    expect(second).toMatchObject({ imported: 0, skipped: 4 });
    expect(await countEntries(group)).toEqual({ expenses: 2, settlements: 2 });
  });
});
