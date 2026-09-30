import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { importRows } from "@/lib/db/schema";
import {
  CREATE_PARTICIPANT,
  commitImportRun,
  saveParticipantMapping,
  stageImport,
} from "@/modules/imports/service";
import type { StagedExpense } from "@/modules/imports/types";
import { createTestGroup, createTestUser } from "../helpers/factories";

/**
 * What an import row that failed says about itself.
 *
 * `import_rows.message` used to be whatever the failure's message was. For a
 * refusal from the database that is Drizzle's — the statement followed by
 * every value in the row — so the row's own description and amounts were
 * copied into a column meant to explain the failure. Only the importer's own
 * refusals, written for a person, are kept now.
 */

const fixture = (name: string): Buffer =>
  readFileSync(path.join(process.cwd(), "tests/fixtures/splitwise", name));

describe("a failed import row", () => {
  it("records a generic reason for a fault, and a domain refusal as written", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, { currencyMode: "separate" });
    const preview = await stageImport(group.access, {
      name: "trip-group.csv",
      bytes: fixture("trip-group.csv"),
    });
    await saveParticipantMapping(
      group.access,
      preview.importRunId,
      Object.fromEntries(
        preview.sourceParticipants.map((name) => [name, CREATE_PARTICIPANT]),
      ),
    );

    const db = getDb();
    const staged = await db
      .select({ id: importRows.id, staged: importRows.staged })
      .from(importRows)
      .where(eq(importRows.importRunId, preview.importRunId))
      .orderBy(asc(importRows.rowNumber));
    const [faulty, unbalanced] = staged.filter(
      (row) => (row.staged as { kind: string }).kind === "expense",
    );

    // A value no amount can be. The fault it causes quotes it — as a refusal
    // from the database quotes every value in the row. (A refusal from the
    // database itself cannot be staged here: without a savepoint around each
    // row it aborts the whole commit, and never reaches the row's message.)
    const leaked = `leak-${randomUUID()}`;
    const faultyRow = faulty.staged as StagedExpense;
    await db
      .update(importRows)
      .set({
        staged: {
          ...faultyRow,
          payers: [{ ...faultyRow.payers[0], amount: leaked }],
        },
      })
      .where(eq(importRows.id, faulty.id));

    // A row the importer itself refuses, whose sentence is written for a
    // person and should still reach one.
    const unbalancedRow = unbalanced.staged as StagedExpense;
    await db
      .update(importRows)
      .set({ staged: { ...unbalancedRow, amount: "1" } })
      .where(eq(importRows.id, unbalanced.id));

    const report = await commitImportRun(preview.importRunId, group.groupId);
    expect(report.failed).toBe(2);

    const [faultyAfter] = await db
      .select({ status: importRows.status, message: importRows.message })
      .from(importRows)
      .where(eq(importRows.id, faulty.id));
    expect(faultyAfter).toEqual({
      status: "error",
      message: "This row could not be saved.",
    });

    const [unbalancedAfter] = await db
      .select({ status: importRows.status, message: importRows.message })
      .from(importRows)
      .where(eq(importRows.id, unbalanced.id));
    expect(unbalancedAfter.status).toBe("error");
    expect(unbalancedAfter.message).toMatch(/^Row does not balance/);
  });
});
