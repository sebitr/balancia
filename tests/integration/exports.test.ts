import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  authorizeGroup,
  AuthorizationError,
  type GuestActor,
} from "@/lib/security/authorization";
import {
  redeemInvitation,
  resolveGuestSession,
} from "@/lib/security/guest-session";
import { createInvitation } from "@/modules/groups/service";
import { createExpense, deleteExpense } from "@/modules/expenses/service";
import { createSettlement } from "@/modules/settlements/service";
import {
  buildGroupExport,
  exportFileName,
  toExpensesCsv,
  toWorkbook,
} from "@/modules/exports/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * Export integration tests.
 *
 * The promise being tested is portability: what comes out must be everything
 * that went in, with no digit lost and nothing silently omitted. The guest
 * case is here too, because the export endpoint is the one place where a
 * guest's permissions differ from a member's in a way that is easy to regress.
 */

async function guestAccessFor(groupId: string, invitationToken: string) {
  // An invitation token is exchanged for a session token, exactly as the
  // /join route does it.
  const redeemed = await redeemInvitation(invitationToken);
  const session = await resolveGuestSession(redeemed.token);
  if (!session) throw new Error("Expected a live guest session");
  const actor: GuestActor = {
    kind: "guest",
    groupId: session.groupId,
    participantId: session.participantId,
    displayName: session.displayName,
    sessionId: session.sessionId,
  };
  return authorizeGroup(actor, groupId);
}

describe("group export", () => {
  it("carries every expense, payer and share with exact minor units", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const group = await createTestGroup(actor, { name: "Lisbon trip" });
    const blaise = await addTestParticipant(group.groupId, "Blaise");

    await createExpense(group.access, {
      description: 'Bar & "Grill"',
      notes: "Window table",
      category: "Food",
      amount: "3001",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "3001" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
      ],
    });

    const data = await buildGroupExport(group.access);

    expect(data.group.name).toBe("Lisbon trip");
    expect(data.expenses).toHaveLength(1);

    const expense = data.expenses[0];
    expect(expense.amount).toBe("3001");
    expect(expense.description).toBe('Bar & "Grill"');
    expect(expense.payers).toEqual([
      {
        participantId: group.ownerParticipantId,
        displayName: "Amélie",
        amount: "3001",
      },
    ]);

    // 3001 split two ways is 1501 / 1500 — the odd minor unit must survive.
    const shareAmounts = expense.shares.map((share) => share.amount).sort();
    expect(shareAmounts).toEqual(["1500", "1501"]);
    const total = expense.shares.reduce(
      (sum, share) => sum + BigInt(share.amount),
      0n,
    );
    expect(total).toBe(3001n);
  });

  it("includes settlements and the balances the app itself displays", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const blaise = await addTestParticipant(group.groupId, "Blaise");

    await createExpense(group.access, {
      description: "Dinner",
      notes: "",
      category: "",
      amount: "4000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "4000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
      ],
    });

    await createSettlement(group.access, {
      fromParticipantId: blaise,
      toParticipantId: group.ownerParticipantId,
      amount: "500",
      currency: "EUR",
      exchangeRate: "",
      settledOn: isoToday(),
      notes: "Part payment",
    });

    const data = await buildGroupExport(group.access);

    expect(data.settlements).toHaveLength(1);
    expect(data.settlements[0].amount).toBe("500");
    expect(data.settlements[0].notes).toBe("Part payment");

    // Blaise owed 2000, paid back 500, so 1500 remains outstanding.
    const eur = data.balances.find((entry) => entry.currency === "EUR");
    const blaiseBalance = eur?.entries.find(
      (entry) => entry.participantId === blaise,
    );
    expect(blaiseBalance?.amount).toBe("-1500");

    // The engine's invariant must hold in the export too.
    const sum = eur?.entries.reduce(
      (total, entry) => total + BigInt(entry.amount),
      0n,
    );
    expect(sum).toBe(0n);
  });

  it("records both original and converted amounts with the frozen rate", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, {
      currencyMode: "converted",
      baseCurrency: "EUR",
    });

    await createExpense(group.access, {
      description: "Tokyo dinner",
      notes: "",
      category: "",
      amount: "10000",
      currency: "JPY",
      exchangeRate: "0.0062",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "10000" }],
      splitMethod: "equal",
      splitEntries: [{ participantId: group.ownerParticipantId }],
    });

    const data = await buildGroupExport(group.access);
    const expense = data.expenses[0];

    expect(expense.currency).toBe("JPY");
    expect(expense.amount).toBe("10000");
    expect(expense.convertedCurrency).toBe("EUR");
    expect(expense.convertedAmount).not.toBeNull();
    // The rate is a PostgreSQL numeric, so it comes back at the column's own
    // scale ("0.006200000000"). What matters is the value, not the padding.
    expect(Number(expense.exchangeRate)).toBe(0.0062);

    // 10000 JPY (a zero-decimal currency) at 0.0062 is 62.00 EUR.
    expect(expense.convertedAmount).toBe("6200");
  });

  it("omits soft-deleted expenses", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);

    const keptId = await createExpense(group.access, {
      description: "Kept",
      notes: "",
      category: "",
      amount: "1000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "1000" }],
      splitMethod: "equal",
      splitEntries: [{ participantId: group.ownerParticipantId }],
    });
    const removedId = await createExpense(group.access, {
      description: "Removed",
      notes: "",
      category: "",
      amount: "2000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "2000" }],
      splitMethod: "equal",
      splitEntries: [{ participantId: group.ownerParticipantId }],
    });
    await deleteExpense(group.access, removedId);

    const data = await buildGroupExport(group.access);
    expect(data.expenses.map((expense) => expense.id)).toEqual([keptId]);
  });

  it("keeps people who were removed, so past expenses still name someone", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    await addTestParticipant(group.groupId, "Blaise");

    const data = await buildGroupExport(group.access);
    expect(data.participants).toHaveLength(2);
    expect(
      data.participants.find((person) => person.displayName === "Blaise")
        ?.hasAccount,
    ).toBe(false);
  });

  it("refuses a guest", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const guest = await addTestParticipant(group.groupId, "Grace");
    const invitation = await createInvitation(group.access, {
      participantId: guest,
    });
    const guestAccess = await guestAccessFor(group.groupId, invitation.token);

    // A guest reads the group fine — it is bulk extraction that is withheld.
    expect(guestAccess.permissions.viewGroup).toBe(true);
    expect(guestAccess.permissions.exportData).toBe(false);
    await expect(buildGroupExport(guestAccess)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});

describe("export formats", () => {
  async function seededGroup() {
    const actor = await createTestUser({ name: "Amélie" });
    const group = await createTestGroup(actor, { name: "Lisbon trip" });
    const blaise = await addTestParticipant(group.groupId, "Blaise");

    await createExpense(group.access, {
      // A description that would execute as a formula if pasted unguarded.
      description: "=1+1 dinner, with a comma",
      notes: "",
      category: "Food",
      amount: "3000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: "2026-08-01",
      payers: [{ participantId: group.ownerParticipantId, amount: "3000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
      ],
    });

    return buildGroupExport(group.access);
  }

  it("writes one CSV row per person per expense, in major units", async () => {
    const csv = toExpensesCsv(await seededGroup());
    const lines = csv.split("\r\n");

    expect(lines[0]).toContain("Date,Description");
    expect(lines).toHaveLength(3); // header + two people
    expect(csv).toContain("Amélie");
    expect(csv).toContain("Blaise");
    // 3000 minor units in EUR is 30.00, and each share is 15.00.
    expect(csv).toContain("30.00");
    expect(csv).toContain("15.00");
  });

  it("neutralises a formula in an exported description", async () => {
    const csv = toExpensesCsv(await seededGroup());
    expect(csv).toContain(`"'=1+1 dinner, with a comma"`);
    expect(csv).not.toContain(`,=1+1`);
  });

  it("writes a workbook with a sheet for each part of the group", async () => {
    const workbook = unzipSync(toWorkbook(await seededGroup()));
    const names = strFromU8(workbook["xl/workbook.xml"]);

    expect(names).toContain('name="Expenses"');
    expect(names).toContain('name="Payments"');
    expect(names).toContain('name="People"');
    expect(names).toContain('name="Balances"');

    // Money lands in numeric cells, so the column can be summed.
    const sheet = strFromU8(workbook["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("<v>30.00</v>");
    expect(sheet).toContain("<v>15.00</v>");
  });
});

describe("exportFileName", () => {
  it("slugifies the group name and stamps the date", () => {
    const name = exportFileName("Lisbon trip 2026!", "json");
    expect(name).toMatch(/^balancia-lisbon-trip-2026-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("falls back when a name has nothing usable in it", () => {
    expect(exportFileName("!!!", "csv")).toMatch(/^balancia-group-/);
  });

  it("keeps letters from non-Latin scripts rather than emptying the name", () => {
    expect(exportFileName("東京", "csv")).toMatch(/^balancia-東京-/);
  });
});
