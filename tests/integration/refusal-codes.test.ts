import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { participants } from "@/lib/db/schema";
import { runAction } from "@/lib/actions";
import {
  authorizeGroup,
  type AuthorizationCode,
  type GuestActor,
} from "@/lib/security/authorization";
import { createExpense } from "@/modules/expenses/service";
import {
  createInvitation,
  removeParticipant,
  setGroupArchived,
} from "@/modules/groups/service";
import {
  commitImportRun,
  CREATE_PARTICIPANT,
  saveParticipantMapping,
  stageImport,
} from "@/modules/imports/service";
import { createSettlement } from "@/modules/settlements/service";
import en from "../../messages/en.json";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * What a refusal from inside a group says, from the service to the sentence.
 *
 * The Server Action funnel translates an `AuthorizationError` by its code. Each
 * of the refusals below used to carry an English sentence and no code, so each
 * reached the reader as the one an outsider gets — "You do not have access to
 * this group" — including the owner of the group, told so for trying to remove
 * themselves. Every case here drives the real service against PostgreSQL, then
 * the same call through `runAction`, so the code and the sentence it becomes
 * are both pinned.
 */

/**
 * `getTranslations` needs a request a node test cannot provide; resolved
 * against the shipped English catalogue, so the sentence checked below is the
 * one a reader would get.
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

async function expectRefusal(
  work: () => Promise<unknown>,
  code: AuthorizationCode,
): Promise<void> {
  await expect(work()).rejects.toMatchObject({
    name: "AuthorizationError",
    code,
  });
  expect(await runAction("test", work)).toEqual({
    ok: false,
    error: en.serverErrors[code],
  });
}

/** Paid by `payer`, split equally between them and `others`. */
function dinner(payer: string, others: readonly string[]) {
  return {
    description: "Dinner",
    notes: "",
    category: "",
    amount: "3000",
    currency: "EUR",
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: payer, amount: "3000" }],
    splitMethod: "equal" as const,
    splitEntries: [payer, ...others].map((participantId) => ({
      participantId,
    })),
  };
}

async function removedAt(participantId: string): Promise<Date | null> {
  const [row] = await getDb()
    .select({ removedAt: participants.removedAt })
    .from(participants)
    .where(eq(participants.id, participantId));
  return row?.removedAt ?? null;
}

describe("naming somebody who is not in the group", () => {
  it("says so for an expense naming somebody removed a minute ago", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const bob = await addTestParticipant(group.groupId, "Bob");
    await removeParticipant(group.access, bob);

    await expectRefusal(
      () =>
        createExpense(group.access, dinner(group.ownerParticipantId, [bob])),
      "participantNotInGroup",
    );
  });

  it("says so for a repayment to somebody from another group", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner, { name: "Mine" });
    const elsewhere = await createTestGroup(owner, { name: "Theirs" });
    const stranger = await addTestParticipant(elsewhere.groupId, "Stranger");

    await expectRefusal(
      () =>
        createSettlement(group.access, {
          fromParticipantId: group.ownerParticipantId,
          toParticipantId: stranger,
          amount: "1000",
          currency: "EUR",
          exchangeRate: "",
          settledOn: isoToday(),
          notes: "",
        }),
      "participantNotInGroup",
    );
  });
});

describe("the people screen", () => {
  it("tells the owner they cannot be removed, and keeps them", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);

    await expectRefusal(
      () => removeParticipant(group.access, group.ownerParticipantId),
      "ownerNotRemovable",
    );
    expect(await removedAt(group.ownerParticipantId)).toBeNull();
  });

  it("does not make a guest link for somebody with an account", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);

    await expectRefusal(
      () =>
        createInvitation(group.access, {
          participantId: group.ownerParticipantId,
        }),
      "participantHasAccount",
    );
  });

  it("tells a guest that removing people is not theirs to do", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const bob = await addTestParticipant(group.groupId, "Bob");
    const guest: GuestActor = {
      kind: "guest",
      groupId: group.groupId,
      participantId: bob,
      displayName: "Bob",
      sessionId: randomUUID(),
    };
    const access = await authorizeGroup(guest, group.groupId);

    await expectRefusal(
      () => removeParticipant(access, group.ownerParticipantId),
      "noPermission",
    );
  });
});

describe("the group as a whole", () => {
  it("says an archived group is archived", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    await setGroupArchived(group.access, true);

    await expectRefusal(
      () => authorizeGroup(owner, group.groupId, { requireActive: true }),
      "groupArchived",
    );
  });

  it("still tells an outsider no more than that they have no access", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const outsider = await createTestUser();

    await expectRefusal(
      () => authorizeGroup(outsider, group.groupId),
      "noGroupAccess",
    );
  });
});

describe("an import", () => {
  it("says who it matched has left since, and how to go on", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const preview = await stageImport(group.access, {
      name: "trip-group.csv",
      bytes: readFileSync(
        path.join(process.cwd(), "tests/fixtures/splitwise/trip-group.csv"),
      ),
    });
    const ada = await addTestParticipant(group.groupId, "Ada");
    await saveParticipantMapping(group.access, preview.importRunId, {
      Ada: ada,
      Blaise: CREATE_PARTICIPANT,
      Grace: CREATE_PARTICIPANT,
    });
    await removeParticipant(group.access, ada);

    await expectRefusal(
      () => commitImportRun(preview.importRunId, group.groupId),
      "importParticipantUnknown",
    );
  });
});
