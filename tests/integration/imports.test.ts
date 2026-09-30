import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
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
} from "@/modules/imports/service";
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
