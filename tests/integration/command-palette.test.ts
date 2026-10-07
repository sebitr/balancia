import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { IntlMessageFormat } from "intl-messageformat";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { groupMembers, participants } from "@/lib/db/schema";
import type { GuestActor, UserActor } from "@/lib/security/authorization";
import { createExpense } from "@/modules/expenses/service";
import { createSettlement } from "@/modules/settlements/service";
import en from "../../messages/en.json";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * "Search or jump to": the command palette's one Server Action, driven as the
 * palette drives it.
 *
 * What is held here is the boundary. The group the browser names is believed
 * only once `requireGroupAccess` has checked it; people are found only in
 * groups the reader is in; a guest searches their one group; and the
 * transactions are a page of the list's own search, so a repayment is found
 * by the sentence the list titles it with.
 */

const cookieActor = vi.hoisted(() => ({
  value: null as UserActor | GuestActor | null,
}));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () =>
    cookieActor.value?.kind === "user" ? cookieActor.value : null,
  getCurrentActor: async () => cookieActor.value,
  getClientIp: async () => "127.0.0.1",
}));

// The list titles a repayment with a translated sentence, and a refusal is
// translated by the action funnel; both from the shipped English catalogue.
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => {
    const messages = (en as unknown as Record<string, Record<string, string>>)[
      namespace
    ];
    const translate = (key: string, values?: Record<string, unknown>) =>
      new IntlMessageFormat(messages[key] ?? key, "en").format(
        values,
      ) as string;
    return Object.assign(translate, { has: (key: string) => key in messages });
  },
}));

// The reader's notation, which a search matches a date in: the default.
vi.mock("@/i18n/preferences", async () => {
  const { createDateFormatter } = await import("@/i18n/format");
  return {
    getDateFormatter: async () =>
      createDateFormatter({
        dateFormat: "auto",
        formatLocale: "en",
        timeZone: "UTC",
      }),
  };
});

const { searchPaletteAction } = await import("@/modules/search/actions");

beforeEach(() => {
  cookieActor.value = null;
});

/** Somebody with an account who joined a group somebody else owns. */
async function addMember(groupId: string, user: UserActor, name: string) {
  const db = getDb();
  const [participant] = await db
    .insert(participants)
    .values({
      groupId,
      displayName: name,
      email: user.email,
      userId: user.userId,
    })
    .returning({ id: participants.id });
  await db.insert(groupMembers).values({
    groupId,
    userId: user.userId,
    participantId: participant!.id,
    role: "member",
  });
  return participant!.id;
}

function expense(description: string, payer: string, others: string[]) {
  return {
    description,
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

/** The reader, two groups of theirs, and one group of a stranger's. */
async function seed() {
  const reader = await createTestUser({ name: "Sébastien" });
  const lisbon = await createTestGroup(reader, { name: "Lisbon, March" });
  const book = await createTestGroup(reader, { name: "Book club" });

  const amelie = await addTestParticipant(lisbon.groupId, "Amélie");
  const jonas = await addTestParticipant(lisbon.groupId, "Jonas");
  const amelieAtBook = await addTestParticipant(book.groupId, "Amélie");

  await createExpense(
    lisbon.access,
    expense("Dinner at Trattoria", amelie, [lisbon.ownerParticipantId]),
  );
  await createExpense(
    lisbon.access,
    expense("Surf lesson", lisbon.ownerParticipantId, [amelie, jonas]),
  );
  await createSettlement(lisbon.access, {
    fromParticipantId: jonas,
    toParticipantId: amelie,
    amount: "1200",
    currency: "EUR",
    exchangeRate: "",
    settledOn: isoToday(),
    notes: "",
  });
  await createExpense(
    book.access,
    expense("Dinner before the meeting", amelieAtBook, [
      book.ownerParticipantId,
    ]),
  );

  const stranger = await createTestUser({ name: "Stranger" });
  const theirs = await createTestGroup(stranger, { name: "Lisbon again" });
  await addTestParticipant(theirs.groupId, "Amélie Martin");

  return { reader, lisbon, book, amelie, jonas, amelieAtBook, theirs };
}

describe("searchPaletteAction", () => {
  it("lists the reader's groups, with where they stand, for an empty field", async () => {
    const { reader, lisbon, book } = await seed();
    cookieActor.value = reader;

    const result = await searchPaletteAction({ query: "", groupId: null });

    expect(result.ok).toBe(true);
    expect(result.data?.groups.map((group) => group.id).sort()).toEqual(
      [lisbon.groupId, book.groupId].sort(),
    );
    // The sidebar's own rows: the figures each group's line is written from.
    const lisbonRow = result.data?.groups.find(
      (group) => group.id === lisbon.groupId,
    );
    expect(lisbonRow?.amounts).toEqual([
      { minorUnits: expect.any(String), currency: "EUR" },
    ]);
    // Nothing typed, nothing else listed.
    expect(result.data?.people).toEqual([]);
    expect(result.data?.entries).toBeNull();
  });

  it("finds a group by its name, and never somebody else's", async () => {
    const { reader, lisbon } = await seed();
    cookieActor.value = reader;

    const result = await searchPaletteAction({
      query: "  LISBON ",
      groupId: null,
    });

    expect(result.data?.groups.map((group) => group.id)).toEqual([
      lisbon.groupId,
    ]);
  });

  it("finds the current group's transactions as the list's search does, a repayment by its sentence", async () => {
    const { reader, lisbon } = await seed();
    cookieActor.value = reader;

    const dinner = await searchPaletteAction({
      query: "dinner",
      groupId: lisbon.groupId,
    });
    expect(dinner.data?.entries).toMatchObject({
      groupId: lisbon.groupId,
      groupName: "Lisbon, March",
      self: lisbon.ownerParticipantId,
    });
    // Only this group's: the book club's dinner is not here.
    expect(dinner.data?.entries?.rows.map((row) => row.title)).toEqual([
      "Dinner at Trattoria",
    ]);

    const repayment = await searchPaletteAction({
      query: "jonas paid amélie",
      groupId: lisbon.groupId,
    });
    expect(repayment.data?.entries?.rows).toEqual([
      expect.objectContaining({
        kind: "settlement",
        title: "Jonas paid Amélie",
      }),
    ]);
  });

  it("searches no transactions outside a group", async () => {
    const { reader } = await seed();
    cookieActor.value = reader;

    const result = await searchPaletteAction({
      query: "dinner",
      groupId: null,
    });
    expect(result.ok).toBe(true);
    expect(result.data?.entries).toBeNull();
  });

  it("finds people in the reader's groups, the current group's first, and leaves out the reader, anybody removed and strangers", async () => {
    const { reader, lisbon, book, amelie, amelieAtBook, jonas } = await seed();
    cookieActor.value = reader;
    await getDb()
      .update(participants)
      .set({ removedAt: new Date() })
      .where(eq(participants.id, jonas));

    const fromBook = await searchPaletteAction({
      query: "amélie",
      groupId: book.groupId,
    });
    expect(fromBook.data?.people).toEqual([
      {
        id: amelieAtBook,
        name: "Amélie",
        groupId: book.groupId,
        groupName: "Book club",
      },
      {
        id: amelie,
        name: "Amélie",
        groupId: lisbon.groupId,
        groupName: "Lisbon, March",
      },
    ]);

    const removed = await searchPaletteAction({
      query: "jonas",
      groupId: lisbon.groupId,
    });
    expect(removed.data?.people).toEqual([]);

    const self = await searchPaletteAction({
      query: "sébastien",
      groupId: null,
    });
    expect(self.data?.people).toEqual([]);
  });

  it("finds people in a group the reader joined rather than made", async () => {
    const { reader } = await seed();
    const friend = await createTestUser({ name: "Mira" });
    const ski = await createTestGroup(friend, { name: "Ski week, Verbier" });
    const ravi = await addTestParticipant(ski.groupId, "Ravi");
    await addMember(ski.groupId, reader, "Sébastien");
    cookieActor.value = reader;

    const result = await searchPaletteAction({ query: "ravi", groupId: null });
    expect(result.data?.people).toEqual([
      {
        id: ravi,
        name: "Ravi",
        groupId: ski.groupId,
        groupName: "Ski week, Verbier",
      },
    ]);
  });

  it("matches case as the list does, in full Unicode", async () => {
    const { reader, amelie } = await seed();
    cookieActor.value = reader;

    const result = await searchPaletteAction({
      query: "AMÉLIE",
      groupId: null,
    });
    expect(result.data?.people.map((person) => person.id)).toContain(amelie);
  });

  it("refuses a group the reader is not in, before reading anything of it", async () => {
    const { reader, theirs } = await seed();
    cookieActor.value = reader;

    const result = await searchPaletteAction({
      query: "amélie",
      groupId: theirs.groupId,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe(en.serverErrors.noGroupAccess);
    expect(result.data).toBeUndefined();
  });

  it("refuses somebody who is not signed in", async () => {
    const result = await searchPaletteAction({ query: "", groupId: null });
    expect(result.ok).toBe(false);
  });

  it("refuses a question that is not one", async () => {
    const { reader } = await seed();
    cookieActor.value = reader;

    for (const input of [
      { query: "x".repeat(101), groupId: null },
      { query: "", groupId: "not-a-group" },
      { groupId: null },
      null,
    ]) {
      const result = await searchPaletteAction(input);
      expect(result.ok).toBe(false);
    }
  });

  it("gives a guest their one group's people and transactions, and no list of groups", async () => {
    const { lisbon, amelie, jonas, book } = await seed();
    cookieActor.value = {
      kind: "guest",
      groupId: lisbon.groupId,
      participantId: jonas,
      displayName: "Jonas",
      sessionId: randomUUID(),
    };

    const result = await searchPaletteAction({
      query: "amélie",
      groupId: lisbon.groupId,
    });
    expect(result.data?.groups).toEqual([]);
    expect(result.data?.people.map((person) => person.id)).toEqual([amelie]);
    expect(result.data?.entries?.self).toBe(jonas);

    const elsewhere = await searchPaletteAction({
      query: "amélie",
      groupId: book.groupId,
    });
    expect(elsewhere.ok).toBe(false);
  });
});
