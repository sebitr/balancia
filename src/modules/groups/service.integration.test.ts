import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { groups } from "@/lib/db/schema";
import { authorizeGroup } from "@/lib/security/authorization";
import { createExpense } from "@/modules/expenses/service";
import {
  createGroup,
  listGroupsForUser,
  listParticipants,
} from "@/modules/groups/service";
import { createTestUser, isoToday } from "../../../tests/helpers/factories";

/**
 * `listGroupsForUser` against a real PostgreSQL.
 *
 * The home screen's ordering and its avatar stacks are built from correlated
 * subqueries that Drizzle passes through as raw SQL, so nothing but an actual
 * database can tell us they are right — a typed unit test would only be
 * checking the shape we asked for, not the shape Postgres returns.
 */

const BASE = {
  description: "",
  currencyMode: "separate" as const,
  timezone: "UTC",
};

async function backdate(groupId: string, when: Date): Promise<void> {
  await getDb()
    .update(groups)
    .set({ createdAt: when })
    .where(eq(groups.id, groupId));
}

describe("listGroupsForUser", () => {
  it("returns the viewer's own participant row, not someone else's", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const created = await createGroup(actor, {
      ...BASE,
      name: "Lisbon trip",
      ownerDisplayName: "Amélie",
      participantNames: ["Blaise"],
    });

    const [summary] = await listGroupsForUser(actor.userId);

    expect(summary.participantId).toBe(created.participantId);
    expect(summary.participantCount).toBe(2);
  });

  it("names the first few participants, oldest first, for the avatar stack", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    await createGroup(actor, {
      ...BASE,
      name: "Office lunches",
      ownerDisplayName: "Amélie",
      participantNames: ["Blaise", "Jonas", "Ravi", "Sofia"],
    });

    const [summary] = await listGroupsForUser(actor.userId);

    // Capped at three, in join order — the stack shows a counter beyond that.
    expect(summary.memberNames).toEqual(["Amélie", "Blaise", "Jonas"]);
    expect(summary.participantCount).toBe(5);
  });

  it("dates a group with no movement from its own creation", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const created = await createGroup(actor, {
      ...BASE,
      name: "Quiet",
      ownerDisplayName: "Amélie",
    });
    const when = new Date("2026-02-01T09:00:00.000Z");
    await backdate(created.id, when);

    const [summary] = await listGroupsForUser(actor.userId);

    // The activity event from creation is the floor here, not the backdated row.
    expect(summary.lastActivityAt.getTime()).toBeGreaterThanOrEqual(
      when.getTime(),
    );
  });

  it("moves a group up the list when an expense is added to it", async () => {
    const actor = await createTestUser({ name: "Amélie" });

    const older = await createGroup(actor, {
      ...BASE,
      name: "Older",
      ownerDisplayName: "Amélie",
      participantNames: ["Blaise"],
    });
    await createGroup(actor, {
      ...BASE,
      name: "Newer",
      ownerDisplayName: "Amélie",
    });

    // `Newer` was created last, so it leads before anything else happens.
    expect((await listGroupsForUser(actor.userId)).map((g) => g.name)).toEqual([
      "Newer",
      "Older",
    ]);

    const access = await authorizeGroup(actor, older.id);
    const [, blaise] = await listParticipants(older.id);

    await createExpense(access, {
      description: "Pastéis",
      notes: "",
      category: "",
      amount: "500",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: older.participantId, amount: "500" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: older.participantId },
        { participantId: blaise.id },
      ],
    });

    // Spending in `Older` is exactly what "last activity" has to notice —
    // `groups.updatedAt`, which this replaced, would not have moved at all.
    expect((await listGroupsForUser(actor.userId)).map((g) => g.name)).toEqual([
      "Older",
      "Newer",
    ]);
  });

  it("sorts archived groups below active ones whatever their activity", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const archived = await createGroup(actor, {
      ...BASE,
      name: "Archived",
      ownerDisplayName: "Amélie",
    });
    await createGroup(actor, {
      ...BASE,
      name: "Active",
      ownerDisplayName: "Amélie",
    });

    await getDb()
      .update(groups)
      .set({ archivedAt: new Date() })
      .where(eq(groups.id, archived.id));

    expect((await listGroupsForUser(actor.userId)).map((g) => g.name)).toEqual([
      "Active",
      "Archived",
    ]);
  });
});
