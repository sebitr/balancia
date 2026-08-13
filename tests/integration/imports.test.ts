import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { expenses, importRows, settlements } from "@/lib/db/schema";
import {
  CREATE_PARTICIPANT,
  ImportError,
  commitImportRun,
  saveParticipantMapping,
  stageImport,
} from "@/modules/imports/service";
import { loadGroupBalances } from "@/modules/balances/service";
import { balancesSumToZero } from "@/modules/balances/engine";
import { listParticipants } from "@/modules/groups/service";
import { createTestGroup, createTestUser } from "../helpers/factories";

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
