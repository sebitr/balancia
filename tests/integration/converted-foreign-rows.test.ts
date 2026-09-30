import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { expenses, settlements } from "@/lib/db/schema";
import {
  CREATE_PARTICIPANT,
  commitImportRun,
  saveParticipantMapping,
  stageImport,
} from "@/modules/imports/service";
import { loadGroupBalances } from "@/modules/balances/service";
import { balancesSumToZero } from "@/modules/balances/engine";
import { loadGroupOverview } from "@/modules/groups/overview";
import { loadGroupStats } from "@/modules/groups/group-stats-service";
import { loadMemberStats } from "@/modules/groups/member-stats-service";
import { listParticipants } from "@/modules/groups/service";
import { loadSettleUp } from "@/modules/settlements/settle-up";
import {
  createTestGroup,
  createTestUser,
  type TestGroup,
} from "../helpers/factories";

/**
 * A converted group holding rows it has no rate for.
 *
 * Imports write foreign rows in their own currency on purpose, and restoring a
 * converted group's backup drops every conversion it carried. Guest and
 * onboarding groups are always converted, so this is not a corner: it is what
 * happens to anybody who brings a Splitwise trip in.
 *
 * Those rows used to be counted in the base at face value — a ¥30 000 ryokan
 * put Aiko €150 up and Ben €150 down, for a room worth about €93. What the
 * documentation promised, and what these tests hold the code to, is that such
 * a row keeps its own currency's balance until somebody re-enters it with a
 * rate.
 */

async function importInto(group: TestGroup, name: string, bytes: Buffer) {
  const preview = await stageImport(group.access, { name, bytes });
  await saveParticipantMapping(
    group.access,
    preview.importRunId,
    Object.fromEntries(
      preview.sourceParticipants.map((source) => [source, CREATE_PARTICIPANT]),
    ),
  );
  const report = await commitImportRun(preview.importRunId, group.groupId);
  expect(report.failed).toBe(0);
  return report;
}

async function idsByName(groupId: string): Promise<Record<string, string>> {
  const people = await listParticipants(groupId);
  return Object.fromEntries(
    people.map((person) => [person.displayName, person.id]),
  );
}

function balanceOf(
  balances: Awaited<ReturnType<typeof loadGroupBalances>>,
  currency: string,
): Map<string, bigint> {
  const entry = balances.currencies.find((one) => one.currency === currency);
  return new Map(
    (entry?.balances ?? []).map((balance) => [
      balance.participantId,
      balance.amount,
    ]),
  );
}

/** A Splitwise trip kept in euros, with one night in Japan on it. */
const SPLITWISE_TRIP = Buffer.from(
  [
    "Date,Description,Category,Cost,Currency,Aiko,Ben",
    "2026-09-01,Dinner,Food and drink,60.00,EUR,30.00,-30.00",
    // JPY has no minor unit: this is thirty thousand yen, stored as 30000.
    "2026-09-02,Ryokan,Hotel,30000,JPY,15000,-15000",
  ].join("\n"),
);

describe("a Splitwise import into a converted group", () => {
  it("keeps the yen row in a yen balance list of its own", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, {
      currencyMode: "converted",
      baseCurrency: "EUR",
    });
    await importInto(group, "trip.csv", SPLITWISE_TRIP);
    const { Aiko: aiko, Ben: ben } = await idsByName(group.groupId);

    // The row is stored exactly as it arrived: yen, and no rate.
    const [ryokan] = await getDb()
      .select()
      .from(expenses)
      .where(eq(expenses.description, "Ryokan"));
    expect(ryokan.currency).toBe("JPY");
    expect(ryokan.amount).toBe(30000n);
    expect(ryokan.convertedAmount).toBeNull();

    const balances = await loadGroupBalances(group.access);
    expect(balances.currencies.map((entry) => entry.currency)).toEqual([
      "EUR",
      "JPY",
    ]);
    // Before, the euro list held the dinner plus 30000 read as cents.
    expect(balanceOf(balances, "EUR").get(aiko)).toBe(3000n);
    expect(balanceOf(balances, "EUR").get(ben)).toBe(-3000n);
    expect(balanceOf(balances, "JPY").get(aiko)).toBe(15000n);
    expect(balanceOf(balances, "JPY").get(ben)).toBe(-15000n);
    for (const entry of balances.currencies) {
      expect(balancesSumToZero(entry.balances)).toBe(true);
    }
    expect(balances.totalSpend.get("EUR")).toBe(6000n);
    expect(balances.totalSpend.get("JPY")).toBe(30000n);
  });

  it("gives settle-up and the overview one section per currency", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, {
      currencyMode: "converted",
      baseCurrency: "EUR",
    });
    await importInto(group, "trip.csv", SPLITWISE_TRIP);
    const { Aiko: aiko, Ben: ben } = await idsByName(group.groupId);

    const settleUp = await loadSettleUp(group.access);
    expect(settleUp.currencies.map((entry) => entry.currency)).toEqual([
      "EUR",
      "JPY",
    ]);
    expect(settleUp.transferCount).toBe(2);
    const yen = settleUp.currencies.find((entry) => entry.currency === "JPY");
    expect(yen?.others).toEqual([
      expect.objectContaining({
        fromParticipantId: ben,
        toParticipantId: aiko,
        currency: "JPY",
        amount: 15000n,
      }),
    ]);

    const overview = await loadGroupOverview(group.access);
    expect(overview.currencies.map((entry) => entry.currency)).toEqual([
      "EUR",
      "JPY",
    ]);
    expect(
      overview.currencies.map((entry) => [entry.currency, entry.totalSpent]),
    ).toEqual([
      ["EUR", 6000n],
      ["JPY", 30000n],
    ]);
  });

  it("leaves the yen out of the group's euro statistics", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, {
      currencyMode: "converted",
      baseCurrency: "EUR",
    });
    await importInto(group, "trip.csv", SPLITWISE_TRIP);

    const stats = await loadGroupStats(group.access, {
      now: new Date("2026-09-29T12:00:00Z"),
    });
    const all = stats.ranges.find((range) => range.key === "all");
    const block = (currency: string) =>
      all?.currencies.find((entry) => entry.currency === currency);

    // The euros lead, although 30000 yen is more minor units than 6000 cents.
    expect(stats.currencies).toEqual(["EUR", "JPY"]);
    expect(block("EUR")?.totalSpent).toBe(6000n);
    expect(block("EUR")?.entryCount).toBe(1);
    expect(block("JPY")?.totalSpent).toBe(30000n);
    // The "open" column still reads each currency's own balance.
    const { Aiko: aiko } = await idsByName(group.groupId);
    expect(
      block("JPY")?.members.find((member) => member.participantId === aiko)
        ?.open,
    ).toBe(15000n);
  });

  it("leaves the yen out of a member's euro statistics", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, {
      currencyMode: "converted",
      baseCurrency: "EUR",
    });
    await importInto(group, "trip.csv", SPLITWISE_TRIP);
    const { Aiko: aiko } = await idsByName(group.groupId);

    const stats = await loadMemberStats(group.access, aiko, {
      now: new Date("2026-09-29T12:00:00Z"),
    });
    const all = stats.ranges.find((range) => range.key === "all");
    const block = (currency: string) =>
      all?.currencies.find((entry) => entry.currency === currency);

    expect(stats.currencies).toEqual(["EUR", "JPY"]);
    expect(block("EUR")?.paid).toBe(6000n);
    expect(block("EUR")?.groupSpent).toBe(6000n);
    expect(block("JPY")?.paid).toBe(30000n);
    expect(block("JPY")?.share).toBe(15000n);
  });
});

/**
 * Restoring a backup.
 *
 * The fixture carries a sterling ferry with the conversion into euros it was
 * recorded at. A restore drops that rate — the staging model has nowhere to
 * put one — so the ferry, and a sterling repayment for it, come back in
 * sterling with no conversion at all.
 */
function backupWithSterlingRepayment(): Buffer {
  const data = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "tests/fixtures/balancia/trip-group.json"),
      "utf8",
    ),
  ) as {
    participants: { id: string; displayName: string }[];
    settlements: Record<string, unknown>[];
  };
  const idOf = (name: string) =>
    data.participants.find((person) => person.displayName === name)?.id;

  // Ada pays Grace back for her half of the ferry, in pounds — converted at
  // the time, as a converted group's export writes it.
  data.settlements = [
    {
      id: "cccccccc-0000-4000-8000-000000000002",
      fromParticipantId: idOf("Ada"),
      fromName: "Ada",
      toParticipantId: idOf("Grace"),
      toName: "Grace",
      amount: "4750",
      currency: "GBP",
      convertedAmount: "5510",
      convertedCurrency: "EUR",
      exchangeRate: "1.16",
      settledOn: "2026-02-20",
      notes: null,
      createdAt: "2026-02-20T19:30:00.000Z",
    },
  ];
  return Buffer.from(JSON.stringify(data));
}

describe("a backup restored into a converted group", () => {
  it("keeps expenses and repayments with no rate in their own currency", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, {
      currencyMode: "converted",
      baseCurrency: "EUR",
    });
    await importInto(group, "backup.json", backupWithSterlingRepayment());
    const {
      Ada: ada,
      Blaise: blaise,
      Grace: grace,
    } = await idsByName(group.groupId);

    const [repayment] = await getDb()
      .select()
      .from(settlements)
      .where(eq(settlements.groupId, group.groupId));
    expect(repayment.currency).toBe("GBP");
    expect(repayment.convertedAmount).toBeNull();

    const balances = await loadGroupBalances(group.access);
    expect(balances.currencies.map((entry) => entry.currency)).toEqual([
      "EUR",
      "GBP",
    ]);
    // The guesthouse and the tram, and nothing in pounds.
    expect(balanceOf(balances, "EUR").get(ada)).toBe(28000n);
    expect(balanceOf(balances, "EUR").get(blaise)).toBe(-13900n);
    expect(balanceOf(balances, "EUR").get(grace)).toBe(-14100n);
    // The ferry, cleared by the repayment made in the same money.
    expect(balanceOf(balances, "GBP").get(ada)).toBe(0n);
    expect(balanceOf(balances, "GBP").get(grace)).toBe(0n);
    for (const entry of balances.currencies) {
      expect(balancesSumToZero(entry.balances)).toBe(true);
    }
    expect(balances.suggestionsByCurrency.get("GBP")).toEqual([]);
  });
});
