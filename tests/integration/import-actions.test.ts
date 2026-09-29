import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { expenses, importRuns, participants } from "@/lib/db/schema";
import type { UserActor } from "@/lib/security/authorization";
import { commitImportAction } from "@/modules/imports/actions";
import { MAX_MAPPED_NAMES } from "@/modules/imports/limits";
import { CREATE_PARTICIPANT, stageImport } from "@/modules/imports/service";
import en from "../../messages/en.json";
import { createTestGroup, createTestUser } from "../helpers/factories";

/**
 * The commit action, called the way the browser calls it.
 *
 * Its mapping comes off the wire, and every `__create__` in it becomes a
 * person in the group. These check that a mapping which does not belong to
 * the run it names is refused before anything is written — not a participant,
 * not an expense, not the mapping itself.
 */

const currentUser = vi.hoisted(() => ({ value: null as UserActor | null }));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () => currentUser.value,
  getCurrentActor: async () => currentUser.value,
  getClientIp: async () => "127.0.0.1",
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

/**
 * `getTranslations` needs a request a node test cannot provide; resolved
 * against the shipped English catalogue, so the refusal checked below is the
 * sentence a reader would get.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: keyof typeof en) => {
    const entries = en[namespace] as Record<string, string>;
    const translate = (key: string) => entries[key] ?? key;
    return Object.assign(translate, {
      has: (key: string) => key in entries,
    });
  },
}));

beforeEach(() => {
  currentUser.value = null;
});

const trip = readFileSync(
  path.join(process.cwd(), "tests/fixtures/splitwise/trip-group.csv"),
);

async function stagedTrip() {
  const actor = await createTestUser();
  currentUser.value = actor;
  const group = await createTestGroup(actor);
  const preview = await stageImport(group.access, {
    name: "trip-group.csv",
    bytes: trip,
  });
  return { group, preview };
}

/** Everything the refused commit could have written, counted. */
async function writtenFor(groupId: string, importRunId: string) {
  const db = getDb();
  const [run] = await db
    .select({
      mapping: importRuns.participantMapping,
      status: importRuns.status,
    })
    .from(importRuns)
    .where(eq(importRuns.id, importRunId));
  const people = await db
    .select({ id: participants.id })
    .from(participants)
    .where(eq(participants.groupId, groupId));
  const entries = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.groupId, groupId));
  return {
    mapping: run.mapping,
    status: run.status,
    people: people.length,
    expenses: entries.length,
  };
}

const NOTHING_WRITTEN = {
  mapping: null,
  status: "ready",
  // The group's owner, and nobody the import would have added.
  people: 1,
  expenses: 0,
};

describe("commitImportAction", () => {
  it("imports a mapping that fits the run", async () => {
    const { group, preview } = await stagedTrip();

    const result = await commitImportAction(
      group.groupId,
      preview.importRunId,
      {
        Ada: CREATE_PARTICIPANT,
        Blaise: CREATE_PARTICIPANT,
        Grace: CREATE_PARTICIPANT,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.imported).toBe(5);
  });

  it("refuses a name the file never staged, and writes nothing", async () => {
    const { group, preview } = await stagedTrip();

    const result = await commitImportAction(
      group.groupId,
      preview.importRunId,
      {
        Ada: CREATE_PARTICIPANT,
        Blaise: CREATE_PARTICIPANT,
        Grace: CREATE_PARTICIPANT,
        Mallory: CREATE_PARTICIPANT,
      },
    );

    expect(result).toEqual({
      ok: false,
      error: en.serverErrors.importMappingInvalid,
    });
    expect(await writtenFor(group.groupId, preview.importRunId)).toEqual(
      NOTHING_WRITTEN,
    );
  });

  it("refuses a participant from another group, and writes nothing", async () => {
    const { group, preview } = await stagedTrip();
    const elsewhere = await createTestGroup(currentUser.value!, {
      name: "Elsewhere",
    });

    const result = await commitImportAction(
      group.groupId,
      preview.importRunId,
      {
        Ada: elsewhere.ownerParticipantId,
        Blaise: CREATE_PARTICIPANT,
        Grace: CREATE_PARTICIPANT,
      },
    );

    expect(result).toEqual({
      ok: false,
      error: en.serverErrors.importParticipantUnknown,
    });
    expect(await writtenFor(group.groupId, preview.importRunId)).toEqual(
      NOTHING_WRITTEN,
    );
  });

  it("refuses a value that is neither a participant ID nor the sentinel", async () => {
    const { group, preview } = await stagedTrip();

    const result = await commitImportAction(
      group.groupId,
      preview.importRunId,
      {
        Ada: "somebody",
        Blaise: CREATE_PARTICIPANT,
        Grace: CREATE_PARTICIPANT,
      },
    );

    expect(result).toEqual({
      ok: false,
      error: en.serverErrors.importMappingInvalid,
    });
    expect(await writtenFor(group.groupId, preview.importRunId)).toEqual(
      NOTHING_WRITTEN,
    );
  });

  it("refuses an oversized mapping before looking anything up", async () => {
    const { group, preview } = await stagedTrip();
    const mapping = Object.fromEntries(
      Array.from({ length: MAX_MAPPED_NAMES + 1 }, (_, index) => [
        `Person ${index}`,
        CREATE_PARTICIPANT,
      ]),
    );

    const result = await commitImportAction(
      group.groupId,
      preview.importRunId,
      mapping,
    );

    expect(result).toEqual({
      ok: false,
      error: en.serverErrors.importMappingInvalid,
    });
    expect(await writtenFor(group.groupId, preview.importRunId)).toEqual(
      NOTHING_WRITTEN,
    );
  });

  it("refuses a run ID that is not one", async () => {
    const { group, preview } = await stagedTrip();

    const result = await commitImportAction(group.groupId, "not-a-run", {
      Ada: CREATE_PARTICIPANT,
    });

    expect(result).toEqual({
      ok: false,
      error: en.serverErrors.importMappingInvalid,
    });
    expect(await writtenFor(group.groupId, preview.importRunId)).toEqual(
      NOTHING_WRITTEN,
    );
  });
});
