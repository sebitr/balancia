import { describe, expect, it } from "vitest";
import { computeBalances } from "@/modules/balances/engine";
import {
  readSplitwiseFixture,
  splitwiseFixtures,
  splitwiseTotalBalances,
} from "../../../tests/helpers/splitwise-totals";
import { splitwiseCsvAdapter } from "./splitwise-csv";
import { splitwiseJsonAdapter } from "./splitwise-json";
import type { ParsedImport, StagedSettlement } from "./types";

/**
 * Every Splitwise fixture has to import onto the balances the export itself
 * reports.
 *
 * Each row can look right on its own and the file still come out wrong: a
 * payment taken the wrong way round has the right people, the right amount
 * and the right date, and it moves both of them by twice what it should. The
 * only check that catches that is the one Splitwise already wrote into the
 * file — its closing "Total balance" row — so every fixture is held to it,
 * through the same balance engine the app uses.
 */

function parseFixture(name: string): ParsedImport {
  const content = readSplitwiseFixture(name);
  const adapter = [splitwiseCsvAdapter, splitwiseJsonAdapter].find(
    (candidate) => candidate.detect(content, name),
  );
  if (!adapter) throw new Error(`No Splitwise adapter reads ${name}`);
  return adapter.parse(content);
}

/** Balances keyed `"<currency>|<person>"`, the source names standing in for ids. */
function balancesAfterImport(parsed: ParsedImport): Record<string, bigint> {
  const rows = parsed.rows.map((entry, index) => ({
    ...entry.row,
    id: `row-${index}`,
  }));
  const currencies = computeBalances({
    participantIds: parsed.participants.map((person) => person.sourceName),
    expenses: rows.flatMap((row) =>
      row.kind === "expense"
        ? [
            {
              id: row.id,
              currency: row.currency,
              direction: row.direction,
              payers: row.payers.map((payer) => ({
                participantId: payer.sourceName,
                amount: BigInt(payer.amount),
              })),
              shares: row.shares.map((share) => ({
                participantId: share.sourceName,
                amount: BigInt(share.amount),
              })),
            },
          ]
        : [],
    ),
    settlements: rows.flatMap((row) =>
      row.kind === "settlement"
        ? [
            {
              id: row.id,
              currency: row.currency,
              fromParticipantId: row.fromSourceName,
              toParticipantId: row.toSourceName,
              amount: BigInt(row.amount),
            },
          ]
        : [],
    ),
  });

  return Object.fromEntries(
    currencies.flatMap((entry) =>
      entry.balances.map((balance) => [
        `${entry.currency}|${balance.participantId}`,
        balance.amount,
      ]),
    ),
  );
}

describe.each(splitwiseFixtures())("Splitwise fixture %s", (name) => {
  it("imports onto the file's own Total balance row", () => {
    expect(balancesAfterImport(parseFixture(name))).toEqual(
      splitwiseTotalBalances(name),
    );
  });
});

describe("a Splitwise payment", () => {
  // The same trip, exported both ways. The JSON backup says outright who paid
  // (`paid_share`) and who received (`owed_share`); the CSV only gives each
  // person's net. The two importers have to agree on which way the money went.
  const settlementIn = (name: string): StagedSettlement => {
    const settlements = parseFixture(name).rows.filter(
      (entry) => entry.row.kind === "settlement",
    );
    expect(settlements).toHaveLength(1);
    return settlements[0].row as StagedSettlement;
  };

  it("runs from the person who paid to the person who received", () => {
    for (const name of ["trip-group.csv", "trip-group.json"]) {
      expect(settlementIn(name)).toMatchObject({
        fromSourceName: "Blaise",
        toSourceName: "Ada",
        amount: "2500",
        currency: "EUR",
      });
    }
  });
});
