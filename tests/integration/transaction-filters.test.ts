import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { IntlMessageFormat } from "intl-messageformat";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getPool } from "@/lib/db/client";
import {
  attachments,
  expensePayers,
  expenseShares,
  expenses,
  recurringExpenses,
  settlements,
} from "@/lib/db/schema";
import { decodeCursor } from "@/lib/db/keyset";
import type { GroupAccess, UserActor } from "@/lib/security/authorization";
import { createDateFormatter } from "@/i18n/format";
import {
  NO_FILTER,
  selectRows,
  sortableByAmount,
  type ListFilter,
  type RowView,
} from "@/components/expenses/list-filter";
import { normalizeLegacyCategory } from "@/modules/categorization";
import { moneyForGroup } from "@/modules/currencies/display";
import { listSpreadEntries } from "@/modules/expenses/service";
import { categoryTotals, type SpreadEntry } from "@/modules/expenses/spread";
import { settlementTotals } from "@/modules/settlements/service";
import en from "../../messages/en.json";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
} from "../helpers/factories";

/**
 * The transactions list's filter, said twice — once in the browser, once in
 * SQL — and held to one meaning.
 *
 * `selectRows` is what a filter means: it is the function the list ran over
 * the whole history back when opening a search downloaded it, and it still
 * runs in the browser when the browser holds every row. So every case here
 * reads the group's whole history the old way, runs `selectRows` over it, and
 * requires the server — paging with the filter attached, a few rows at a
 * time — to hand back exactly those rows, in exactly that order, once each.
 *
 * The seeded groups are built to make that hard: hundreds of rows, repayments
 * mixed in, three currencies with two exponents, conversions and one
 * unconverted foreign row, ties on date and on amount, an import's worth of
 * rows sharing one clock, titles in upper case with accents, Greek and a
 * dotted İ, and titles and notes full of `%`, `_` and `\`.
 */

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => {
    const messages = (en as unknown as Record<string, Record<string, string>>)[
      namespace
    ];
    return (key: string, values?: Record<string, unknown>) =>
      new IntlMessageFormat(messages[key], "en").format(values) as string;
  },
}));

// The route reads the reader's notation from the request; here it is always
// the default, in English.
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

const cookieActor = vi.hoisted(() => ({ value: null as UserActor | null }));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () => cookieActor.value,
  getCurrentActor: async () => cookieActor.value,
  getClientIp: async () => "127.0.0.1",
}));

const { countTransactions, loadTransactionPage } =
  await import("@/modules/expenses/transactions");
const route = await import("@/app/api/groups/[groupId]/transactions/route");

beforeEach(() => {
  cookieActor.value = null;
});

const TODAY = "2026-08-24";

/** How the reader writes dates, one per notation the search has to meet. */
const ENGLISH = createDateFormatter({
  dateFormat: "auto",
  formatLocale: "en",
  timeZone: "UTC",
}).plain;
const FRENCH = createDateFormatter({
  dateFormat: "auto",
  formatLocale: "fr",
  timeZone: "UTC",
}).plain;
const NUMERIC = createDateFormatter({
  dateFormat: "dmy",
  formatLocale: "en",
  timeZone: "UTC",
}).plain;

/** A small seeded generator, so a failure can be run again exactly. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const TITLES = [
  "Hôtel du Lac",
  "HÔTEL DE LA GARE",
  "École de ski",
  "ÉCOLE",
  "Migros",
  "Tip 100%",
  "Tip 1000",
  "a_b",
  "axb",
  "back\\slash",
  "Dinner",
  "ΣΟΦΙΑ ΤΑΞΙΣ",
  "İstanbul ferry",
  "STRASSE",
  "Straße",
  "Uber",
  "Coop",
] as const;

const NOTES = [
  null,
  null,
  null,
  "Bus tickets",
  "for the hotel",
  "100% of it",
  "ÉTÉ",
] as const;

const FILED: readonly (readonly [string | null, string | null])[] = [
  [null, null],
  ["groceries", null],
  ["lodging", null],
  ["transport", "fuel"],
  ["transport", null],
  ["restaurants", null],
  ["home", "rent"],
  ["home", null],
  // A legacy code and an import's free text, both kept verbatim.
  ["housing", null],
  ["Imported free text", null],
];

/**
 * Month and year edges around `TODAY`, a day after it, and a spread of days
 * back to 2019 — few enough that many rows share one.
 */
function datePool(random: () => number): string[] {
  const days = [
    "2026-08-24",
    "2026-08-13",
    "2026-08-01",
    "2026-07-31",
    "2026-01-01",
    "2025-12-31",
    "2026-09-02",
    "2019-07-02",
  ];
  const start = Date.UTC(2019, 0, 1);
  const end = Date.UTC(2026, 7, 24);
  while (days.length < 90) {
    const at =
      start + Math.floor(random() * ((end - start) / 86_400_000)) * 86_400_000;
    const day = new Date(at).toISOString().slice(0, 10);
    if (!days.includes(day)) days.push(day);
  }
  return days;
}

interface Seeded {
  readonly access: GroupAccess;
  readonly people: {
    readonly ada: string;
    readonly bob: string;
    readonly chloe: string;
    readonly zoe: string;
  };
}

type Kind = "converted" | "separate";

/**
 * One group's history, written straight into the tables.
 *
 * Not through `createExpense`: the code under test is the read, and the rows it
 * has to survive — a conversion frozen at write time next to one that never
 * happened, five hundred rows on one clock, a deleted receipt — are easier to
 * state than to provoke.
 */
async function seedGroup(
  kind: Kind,
  size: { expenses: number; settlements: number } = {
    expenses: 260,
    settlements: 50,
  },
): Promise<Seeded> {
  const db = getDb();
  const random = generator(kind === "converted" ? 2019 : 2026);
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(random() * values.length)];

  const owner = await createTestUser({ name: "Ada" });
  const group = await createTestGroup(owner, {
    name: kind,
    currencyMode: kind,
    baseCurrency: kind === "converted" ? "EUR" : null,
  });
  const people = {
    ada: group.ownerParticipantId,
    bob: await addTestParticipant(group.groupId, "Bob"),
    chloe: await addTestParticipant(group.groupId, "Chloé"),
    // An underscore in a name, which is a wildcard to `LIKE`.
    zoe: await addTestParticipant(group.groupId, "Zoë_B"),
  };
  const everyone = Object.values(people);

  const [template] = await db
    .insert(recurringExpenses)
    .values({
      groupId: group.groupId,
      description: "Rent",
      amount: 100_000n,
      currency: "EUR",
      payers: [],
      splitMethod: "equal",
      splitInput: { method: "equal", entries: [] },
      frequency: "monthly",
      timezone: "UTC",
      startDate: "2020-01-01",
      createdByActorType: "user",
    })
    .returning({ id: recurringExpenses.id });

  const days = datePool(random);
  const clock = Date.UTC(2026, 0, 1);
  // An import: forty rows on one date and one transaction clock, so only the
  // id is left to order them by.
  const imported = new Date(Date.UTC(2025, 5, 1, 12, 0, 0));

  /** A currency, and what a converted group froze it at, if anything. */
  function money(amount: bigint): {
    currency: string;
    convertedAmount: bigint | null;
    convertedCurrency: string | null;
    exchangeRate: string | null;
  } {
    const roll = random();
    const none = {
      convertedAmount: null,
      convertedCurrency: null,
      exchangeRate: null,
    };
    if (kind === "separate") {
      return {
        currency: roll < 0.6 ? "EUR" : roll < 0.85 ? "JPY" : "USD",
        ...none,
      };
    }
    if (roll < 0.7) return { currency: "EUR", ...none };
    if (roll < 0.85) {
      return {
        currency: "USD",
        convertedAmount: (amount * 9n) / 10n,
        convertedCurrency: "EUR",
        exchangeRate: "0.9",
      };
    }
    if (roll < 0.95) {
      return {
        currency: "JPY",
        convertedAmount: (amount * 62n) / 100n,
        convertedCurrency: "EUR",
        exchangeRate: "0.0062",
      };
    }
    // Recorded before the group converted, and never converted since.
    return { currency: "JPY", ...none };
  }

  /** `total` over `count` people, the remainder on the first. */
  function split(total: bigint, count: number): bigint[] {
    const each = total / BigInt(count);
    return Array.from({ length: count }, (_, index) =>
      index === 0 ? total - each * BigInt(count - 1) : each,
    );
  }

  const expenseRows: (typeof expenses.$inferInsert)[] = [];
  const payerRows: (typeof expensePayers.$inferInsert)[] = [];
  const shareRows: (typeof expenseShares.$inferInsert)[] = [];
  const attachmentRows: (typeof attachments.$inferInsert)[] = [];

  for (let index = 0; index < size.expenses; index++) {
    const id = randomUUID();
    const inBatch = index < 40;
    // Two rows every group has, whatever the dice say, so the searches that
    // run from a title into its date and the rarest combination of chips
    // always have something to find.
    const fixed =
      index === 40
        ? { title: "Dinner", date: "2026-08-13", series: false, receipt: false }
        : index === 41
          ? {
              title: "Hôtel du Lac",
              date: "2026-08-13",
              series: true,
              receipt: true,
            }
          : null;
    // Some amounts repeat on purpose, for largest-first to break ties on.
    const amount =
      random() < 0.15 ? 5000n : BigInt(1 + Math.floor(random() * 250_000));
    const stored = money(amount);
    const [category, subcategory] = pick(FILED);
    const title = pick(TITLES);
    const day = pick(days);
    const series = random() < 0.1;
    const deleted = random() < 0.05;
    expenseRows.push({
      id,
      groupId: group.groupId,
      direction: random() < 0.15 ? "in" : "out",
      description: fixed?.title ?? title,
      // Never searched: an expense's notes stay on its own screen.
      notes: random() < 0.3 ? "never searched" : null,
      category,
      subcategory,
      amount,
      ...stored,
      exchangeRateSource: stored.exchangeRate === null ? null : "manual",
      splitMethod: "equal",
      expenseDate: inBatch ? "2025-06-01" : (fixed?.date ?? day),
      createdByActorType: "user",
      recurringExpenseId: (fixed?.series ?? series) ? template.id : null,
      createdAt: inBatch ? imported : new Date(clock + index * 1_000),
      deletedAt: deleted && fixed === null ? new Date() : null,
    });

    const payers = random() < 0.25 ? 2 : 1;
    const payerIds = [...everyone].sort(() => random() - 0.5).slice(0, payers);
    const paid = split(amount, payers);
    const paidConverted =
      stored.convertedAmount === null
        ? null
        : split(stored.convertedAmount, payers);
    payerIds.forEach((participantId, at) =>
      payerRows.push({
        expenseId: id,
        participantId,
        amount: paid[at],
        convertedAmount: paidConverted?.[at] ?? null,
      }),
    );

    const sharers = 1 + Math.floor(random() * 3);
    const shareIds = [...everyone].sort(() => random() - 0.5).slice(0, sharers);
    const owed = split(amount, sharers);
    const owedConverted =
      stored.convertedAmount === null
        ? null
        : split(stored.convertedAmount, sharers);
    shareIds.forEach((participantId, at) =>
      shareRows.push({
        expenseId: id,
        participantId,
        amount: owed[at],
        convertedAmount: owedConverted?.[at] ?? null,
      }),
    );

    const receipt = fixed?.receipt ? 0.1 : random();
    if (receipt < 0.16) {
      attachmentRows.push({
        groupId: group.groupId,
        expenseId: id,
        storageKey: randomUUID(),
        fileName: "receipt.jpg",
        contentType: "image/jpeg",
        byteSize: 1024n,
        checksum: "x",
        // A deleted receipt is no receipt.
        deletedAt: receipt < 0.04 ? new Date() : null,
      });
    }
  }

  const settlementRows: (typeof settlements.$inferInsert)[] = [];
  for (let index = 0; index < size.settlements; index++) {
    const [from, to] = [...everyone].sort(() => random() - 0.5);
    const amount = BigInt(1 + Math.floor(random() * 100_000));
    const note = pick(NOTES);
    const day = pick(days);
    const deleted = random() < 0.05;
    // Ada paid Bob back for the bus on the 13th, in every group.
    const fixed = index === 0;
    settlementRows.push({
      groupId: group.groupId,
      fromParticipantId: fixed ? people.ada : from,
      toParticipantId: fixed ? people.bob : to,
      amount,
      ...money(amount),
      notes: fixed ? "Bus tickets" : note,
      settledOn: fixed ? "2026-08-13" : day,
      createdByActorType: "user",
      createdAt: new Date(clock + index * 1_500),
      deletedAt: deleted && !fixed ? new Date() : null,
    });
  }

  await db.insert(expenses).values(expenseRows);
  await db.insert(expensePayers).values(payerRows);
  await db.insert(expenseShares).values(shareRows);
  if (attachmentRows.length > 0) {
    await db.insert(attachments).values(attachmentRows);
  }
  await db.insert(settlements).values(settlementRows);

  return { access: group.access, people };
}

/** Every row the group holds, newest first — what the eager path used to read. */
async function everything(
  access: GroupAccess,
  dateText = ENGLISH,
): Promise<RowView[]> {
  const page = await loadTransactionPage(access, {
    limit: 5_000,
    dateText,
    today: TODAY,
  });
  expect(page.cursor).toBeNull();
  return [...page.rows];
}

/** The server's answer to `filter`, read a page at a time to the end. */
async function paged(
  access: GroupAccess,
  filter: ListFilter,
  options: { pageSize?: number; dateText?: (date: string) => string } = {},
): Promise<{ rows: RowView[]; pages: number }> {
  const rows: RowView[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await loadTransactionPage(access, {
      filter,
      limit: options.pageSize ?? 25,
      cursor: decodeCursor(cursor),
      dateText: options.dateText ?? ENGLISH,
      today: TODAY,
    });
    // A page is never empty while there is more: that would be a cursor
    // pointing at nothing.
    if (page.cursor !== null) expect(page.rows.length).toBeGreaterThan(0);
    rows.push(...page.rows);
    cursor = page.cursor;
    pages += 1;
    expect(pages).toBeLessThan(500);
  } while (cursor !== null);
  return { rows, pages };
}

const ids = (rows: readonly RowView[]) =>
  rows.map((row) => `${row.kind}:${row.id}`);

/**
 * Rows as compared: whole, but with each row's payers in a fixed order.
 * `listExpenses` reads them without one, so two reads of the same expense may
 * list its two payers either way round — which says nothing about a filter.
 */
const settled = (rows: readonly RowView[]) =>
  rows.map((row) => ({ ...row, payers: [...row.payers].sort() }));

/**
 * `filter` both ways, and the same answer: the same rows, in the same order,
 * every one exactly once, and a count that agrees with them.
 */
async function sameBothWays(
  seeded: Seeded,
  overrides: Partial<ListFilter>,
  options: {
    dateText?: (date: string) => string;
    pageSize?: number;
    access?: GroupAccess;
  } = {},
): Promise<RowView[]> {
  const access = options.access ?? seeded.access;
  const dateText = options.dateText ?? ENGLISH;
  const filter: ListFilter = { ...NO_FILTER, ...overrides };
  const expected = selectRows(await everything(access, dateText), filter, {
    today: TODAY,
    dateText,
  });

  const { rows } = await paged(access, filter, {
    pageSize: options.pageSize,
    dateText,
  });
  expect(new Set(ids(rows)).size).toBe(rows.length);
  expect(ids(rows)).toEqual(ids(expected));
  expect(settled(rows)).toEqual(settled(expected));

  const count = await countTransactions(access, {
    filter,
    dateText,
    today: TODAY,
  });
  expect(count).toBe(expected.length);
  return expected;
}

type Case = readonly [
  name: string,
  filter: (people: Seeded["people"]) => Partial<ListFilter>,
  /** Built to match nothing, rather than having happened to. */
  empty?: "empty",
];

const CASES: readonly Case[] = [
  ["nothing at all", () => ({})],
  ["spending only", () => ({ kinds: ["expense"] })],
  ["income only", () => ({ kinds: ["revenue"] })],
  ["repayments only", () => ({ kinds: ["settlement"] })],
  ["spending and repayments", () => ({ kinds: ["expense", "settlement"] })],
  ["spending and income", () => ({ kinds: ["expense", "revenue"] })],
  ["one category", () => ({ categories: ["groceries"] })],
  // Repayments file under the empty key too, as they do in the browser.
  ["uncategorised", () => ({ categories: [""] })],
  ["two categories", () => ({ categories: ["lodging", "transport"] })],
  ["a legacy code, as stored", () => ({ categories: ["housing"] })],
  ["an import's free text", () => ({ categories: ["Imported free text"] })],
  ["a subcategory", () => ({ subcategories: ["transport.fuel"] })],
  [
    "a category and part of another",
    () => ({ categories: ["groceries"], subcategories: ["home.rent"] }),
  ],
  ["this month", () => ({ when: "month" })],
  ["this year", () => ({ when: "year" })],
  [
    "a custom range",
    () => ({ when: "custom", from: "2021-01-01", to: "2022-12-31" }),
  ],
  ["a range open at one end", () => ({ when: "custom", from: "2026-01-01" })],
  [
    "a range left over from another period",
    () => ({ when: "year", from: "2021-01-01", to: "2021-01-02" }),
  ],
  ["a minimum", () => ({ min: "100" })],
  ["a maximum with a decimal", () => ({ max: "250.5" })],
  ["both ends, with a comma", () => ({ min: "12,5", max: "300" })],
  // 500 is 50 000 cents and 500 yen: the currency's exponent decides.
  ["a bound read in each row's own currency", () => ({ min: "500" })],
  ["a bound that is not a number yet", () => ({ min: "abc", max: "." })],
  ["one payer", ({ bob }) => ({ payers: [bob] })],
  ["any of two payers", ({ ada, zoe }) => ({ payers: [ada, zoe] })],
  ["a payer that is not an id", () => ({ payers: ["bob"] }), "empty"],
  [
    "a real id, spelled in capitals",
    ({ bob }) => ({ payers: [bob.toUpperCase()] }),
    "empty",
  ],
  ["what you owe", () => ({ positions: ["owe"] })],
  ["what you get back", () => ({ positions: ["back"] })],
  ["nothing for you", () => ({ positions: ["flat"] })],
  ["owe or nothing", () => ({ positions: ["owe", "flat"] })],
  ["every position", () => ({ positions: ["owe", "back", "flat"] })],
  ["from a series", () => ({ properties: ["series"] })],
  ["with a receipt", () => ({ properties: ["receipt"] })],
  ["a series with a receipt", () => ({ properties: ["series", "receipt"] })],
  ["oldest first", () => ({ sort: "oldest" })],
  ["largest first", () => ({ sort: "largest" })],
  [
    "largest spending over fifty",
    () => ({ sort: "largest", kinds: ["expense"], min: "50" }),
  ],
  [
    "one payer's debts, oldest first",
    ({ bob }) => ({ payers: [bob], positions: ["owe"], sort: "oldest" }),
  ],
  [
    "this year's hotels, largest first",
    () => ({ query: "hôtel", when: "year", sort: "largest" }),
  ],
  // The search field.
  ["a word, in any case", () => ({ query: "DINNER" })],
  ["an accented word typed in lower case", () => ({ query: "hôtel" })],
  ["an accented capital", () => ({ query: "école" })],
  // No accent folding, on either side: this finds the note, not the titles.
  ["the same word without its accent", () => ({ query: "hotel" })],
  ["a percent sign, literally", () => ({ query: "100%" })],
  ["a lone percent sign", () => ({ query: "%" })],
  ["an underscore, literally", () => ({ query: "a_b" })],
  ["a lone underscore", () => ({ query: "_" })],
  ["a backslash", () => ({ query: "\\" })],
  ["Greek, with a final sigma", () => ({ query: "ταξις" })],
  // "İ" lowers to "i" and a combining dot, in JavaScript and here alike.
  ["a dotted capital I", () => ({ query: "i̇stanbul" })],
  ["a sharp s", () => ({ query: "straße" })],
  ["a repayment's title", () => ({ query: "paid" })],
  // Ada is the reader, so her own repayments are titled from her side and
  // only one between two other people names both.
  ["who paid whom", () => ({ query: "bob paid" })],
  ["a repayment the reader made", () => ({ query: "you paid bob back" })],
  ["a repayment the reader received", () => ({ query: "paid you back" })],
  ["a name with an underscore in it", () => ({ query: "zoë_b" })],
  ["a repayment's note", () => ({ query: "bus" })],
  ["a year, in the date", () => ({ query: "2019" })],
  ["a month, in the date", () => ({ query: "aug" })],
  ["a day and month, in the date", () => ({ query: "aug 13" })],
  // `${title} ${note ?? ""} ${date}`: an expense has two spaces before it.
  ["from a title into its date", () => ({ query: "dinner  aug" })],
  ["from a note into its date", () => ({ query: "tickets aug" })],
  ["spaces around the words", () => ({ query: "  migros  " })],
  ["nothing that is anywhere", () => ({ query: "zzz" }), "empty"],
];

describe.each([
  ["a converted group", "converted"] as const,
  ["a group in several currencies", "separate"] as const,
])("the transactions filter, in %s", (_, kind) => {
  for (const [name, build, empty] of CASES) {
    it(`agrees with the browser on ${name}`, async () => {
      const seeded = await seedGroup(kind);
      const expected = await sameBothWays(seeded, build(seeded.people));
      // A case that matches nothing proves nothing, unless that was the point.
      if (empty) expect(expected).toEqual([]);
      else expect(expected.length).toBeGreaterThan(0);
    });
  }
});

describe("the transactions filter, beyond the cases", () => {
  it("returns every match once and in order, however small the pages", async () => {
    const seeded = await seedGroup("converted");
    for (const overrides of [
      {},
      { kinds: ["expense", "settlement"] },
      { sort: "oldest" },
      { sort: "largest" },
      { query: "a", sort: "largest" },
      { positions: ["flat"], sort: "oldest" },
    ] as const satisfies readonly Partial<ListFilter>[]) {
      // Seven is small enough that the import's forty rows on one clock span
      // several pages, and a page boundary falls inside every run of ties.
      await sameBothWays(seeded, overrides, { pageSize: 7 });
    }
  });

  it("finds a date written in French", async () => {
    const seeded = await seedGroup("converted");
    // "13 août 2026" — and, run on from a repayment's note or an expense
    // with none, "Bus tickets 13 août" and "Dinner  13 août".
    for (const query of ["août", "13 août", "tickets 13", "dinner  13 a"]) {
      const found = await sameBothWays(seeded, { query }, { dateText: FRENCH });
      expect(found.length).toBeGreaterThan(0);
    }
  });

  it("finds a date written the reader's own way", async () => {
    const seeded = await seedGroup("separate");
    for (const query of ["13/08/2026", "/08/", "2019", "lac  13/"]) {
      const found = await sameBothWays(
        seeded,
        { query },
        { dateText: NUMERIC },
      );
      expect(found.length).toBeGreaterThan(0);
    }
  });

  it("finds nothing of yours for a reader with no place in the group", async () => {
    const seeded = await seedGroup("converted");
    const stranger = { ...seeded.access, participantId: null };
    const flat = await sameBothWays(
      seeded,
      { positions: ["flat"] },
      { access: stranger },
    );
    expect(flat.length).toBeGreaterThan(0);
    await sameBothWays(seeded, { positions: ["owe"] }, { access: stranger });
  });

  it("reads percent signs, underscores and backslashes as themselves", async () => {
    const seeded = await seedGroup("converted");
    const titles = async (query: string) =>
      new Set(
        (await paged(seeded.access, { ...NO_FILTER, query })).rows.map(
          (row) => row.note ?? row.title,
        ),
      );

    // `LIKE '%100%%'` would take "Tip 1000" as well.
    expect(await titles("100%")).toEqual(new Set(["Tip 100%", "100% of it"]));
    // `LIKE '%a_b%'` would take "axb".
    expect(await titles("a_b")).toEqual(new Set(["a_b"]));
    expect(await titles("\\")).toEqual(new Set(["back\\slash"]));
  });

  it("folds case beyond ASCII, which the database's own locale does not", async () => {
    const seeded = await seedGroup("converted");
    const titles = async (query: string) =>
      new Set(
        (await paged(seeded.access, { ...NO_FILTER, query })).rows.map(
          (row) => row.title,
        ),
      );

    expect(await titles("école")).toEqual(new Set(["École de ski", "ÉCOLE"]));
    expect(await titles("hôtel de la")).toEqual(new Set(["HÔTEL DE LA GARE"]));
  });

  it("does not read a page of largest-first on from a newest-first cursor", async () => {
    const seeded = await seedGroup("separate");
    const newest = await loadTransactionPage(seeded.access, { limit: 5 });
    // A cursor from another order is no position in this one: from the top.
    const largest = await loadTransactionPage(seeded.access, {
      limit: 5,
      filter: { ...NO_FILTER, sort: "largest" },
      cursor: decodeCursor(newest.cursor),
    });
    const top = await loadTransactionPage(seeded.access, {
      limit: 5,
      filter: { ...NO_FILTER, sort: "largest" },
    });
    expect(ids(largest.rows)).toEqual(ids(top.rows));
  });
});

describe("the category spread and the screen's other whole-group facts", () => {
  it("adds up in the database to what adding up every row gave", async () => {
    for (const kind of ["converted", "separate"] as const) {
      const seeded = await seedGroup(kind);
      const group = {
        mode: seeded.access.group.currencyMode,
        baseCurrency: seeded.access.group.baseCurrency,
      };

      // Every live expense, one row each: what the page used to read.
      const rows: SpreadEntry[] = await getDb()
        .select({
          direction: expenses.direction,
          category: expenses.category,
          subcategory: expenses.subcategory,
          amount: expenses.amount,
          currency: expenses.currency,
          convertedAmount: expenses.convertedAmount,
          convertedCurrency: expenses.convertedCurrency,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.groupId, seeded.access.groupId),
            isNull(expenses.deletedAt),
          ),
        );
      const sums = await listSpreadEntries(seeded.access.groupId);

      // Tens of rows rather than hundreds, and the same spread from them.
      expect(sums.length).toBeLessThan(rows.length / 2);
      expect(categoryTotals(sums, group)).toEqual(categoryTotals(rows, group));

      // The filter sheet's counts per category.
      const countOf = (entries: readonly { category: string | null }[]) => {
        const counts: Record<string, number> = {};
        for (const entry of entries) {
          const category = normalizeLegacyCategory(entry.category);
          if (category !== null) counts[category] = (counts[category] ?? 0) + 1;
        }
        return counts;
      };
      const summed: Record<string, number> = {};
      for (const entry of sums) {
        const category = normalizeLegacyCategory(entry.category);
        if (category !== null) {
          summed[category] = (summed[category] ?? 0) + entry.count;
        }
      }
      expect(summed).toEqual(countOf(rows));

      // Whether amounts can be ranked, over every row the list could show.
      const all = await everything(seeded.access);
      const repaid = await settlementTotals(seeded.access.groupId);
      const listedIn = new Set(
        [...sums, ...repaid].map(
          (entry) => moneyForGroup(entry, group).currency,
        ),
      );
      expect(listedIn.size <= 1).toBe(sortableByAmount(all));
      expect(repaid.reduce((total, entry) => total + entry.count, 0)).toBe(
        all.filter((row) => row.kind === "settlement").length,
      );
    }
  });
});

describe("what a search costs", () => {
  /**
   * Every statement the pool runs while `work` does, and every row they
   * return — which is what crossed from the database to the server.
   */
  async function measured<T>(
    work: () => Promise<T>,
  ): Promise<{ result: T; queries: number; rowsRead: number }> {
    const pool = getPool();
    const original = pool.query;
    let queries = 0;
    let rowsRead = 0;
    pool.query = ((...args: Parameters<typeof original>) => {
      queries += 1;
      const result = (original as (...a: unknown[]) => unknown).apply(
        pool,
        args,
      );
      if (result instanceof Promise) {
        return result.then((answer: { rowCount?: number | null }) => {
          rowsRead += answer.rowCount ?? 0;
          return answer;
        });
      }
      return result;
    }) as typeof original;
    try {
      return { result: await work(), queries, rowsRead };
    } finally {
      pool.query = original;
    }
  }

  it("reads a page of matches rather than the group's whole history", async () => {
    const seeded = await seedGroup("converted", {
      expenses: 1_200,
      settlements: 100,
    });
    const filter = { ...NO_FILTER, query: "hôtel du" };

    // Before: the browser asked for 500-row pages until the list ran out, and
    // searched what came back.
    const before = await measured(async () => {
      const rows: RowView[] = [];
      let cursor: string | null = null;
      let requests = 0;
      do {
        const page = await loadTransactionPage(seeded.access, {
          limit: 500,
          cursor: decodeCursor(cursor),
        });
        rows.push(...page.rows);
        cursor = page.cursor;
        requests += 1;
      } while (cursor !== null);
      return {
        requests,
        sent: rows.length,
        matches: selectRows(rows, filter, { today: TODAY, dateText: ENGLISH }),
      };
    });

    // After: one request, carrying the filter, at the ordinary page size —
    // which is the whole of what a reader who has not scrolled yet sees.
    const after = await measured(() =>
      loadTransactionPage(seeded.access, { filter, dateText: ENGLISH }),
    );

    const matches = before.result.matches;
    expect(matches.length).toBeGreaterThan(40);
    expect(settled(after.result.rows)).toEqual(settled(matches.slice(0, 40)));

    expect(before.result.requests).toBe(3);
    expect(before.result.sent).toBeGreaterThan(1_200);
    expect(after.result.rows).toHaveLength(40);
    expect(after.rowsRead).toBeLessThan(before.rowsRead / 5);

    console.info(
      `search "${filter.query}" over ${before.result.sent} transactions ` +
        `(${matches.length} matches): ` +
        `before ${before.result.requests} requests, ${before.result.sent} rows sent, ` +
        `${before.queries} queries, ${before.rowsRead} rows read; ` +
        `after 1 request, ${after.result.rows.length} rows sent, ` +
        `${after.queries} queries, ${after.rowsRead} rows read`,
    );
  });
});

describe("GET /api/groups/:groupId/transactions", () => {
  function get(groupId: string, query = ""): Promise<Response> {
    return route.GET(
      new Request(
        `http://localhost/api/groups/${groupId}/transactions${query}`,
      ),
      { params: Promise.resolve({ groupId }) } as never,
    );
  }

  async function signedIn(kind: Kind) {
    const seeded = await seedGroup(kind, { expenses: 120, settlements: 20 });
    const actor = seeded.access.actor;
    if (actor.kind !== "user") throw new Error("expected a user");
    cookieActor.value = actor;
    return seeded;
  }

  it("answers an older client, which sends no filter, exactly as before", async () => {
    const seeded = await signedIn("separate");
    const response = await get(seeded.access.groupId, "?limit=10");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rows: RowView[];
      cursor: string | null;
    };
    const page = await loadTransactionPage(seeded.access, { limit: 10 });
    expect(settled(body.rows)).toEqual(settled(page.rows));
    expect(body.cursor).toBe(page.cursor);
    // Newest first, with the three-part cursor it always had.
    expect(body.cursor?.split("|")).toHaveLength(3);
  });

  it("narrows and orders by the list's own parameters", async () => {
    const seeded = await signedIn("converted");
    const response = await get(
      seeded.access.groupId,
      "?q=h%C3%B4tel&kind=expense&sort=largest&limit=3",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rows: RowView[];
      cursor: string | null;
    };
    const filter: ListFilter = {
      ...NO_FILTER,
      query: "hôtel",
      kinds: ["expense"],
      sort: "largest",
    };
    const expected = selectRows(await everything(seeded.access), filter, {
      today: TODAY,
      dateText: ENGLISH,
    });
    expect(settled(body.rows)).toEqual(settled(expected.slice(0, 3)));
    // Largest first carries the amount it is ranked by.
    expect(body.cursor?.split("|")).toHaveLength(4);
  });

  it("counts what a filter would show", async () => {
    const seeded = await signedIn("converted");
    const response = await get(
      seeded.access.groupId,
      "?count=1&kind=settlement",
    );
    expect(response.status).toBe(200);
    const all = await everything(seeded.access);
    expect(await response.json()).toEqual({
      count: all.filter((row) => row.kind === "settlement").length,
    });
  });

  it("refuses a filter too big to be a question", async () => {
    const seeded = await signedIn("separate");
    const response = await get(seeded.access.groupId, `?q=${"a".repeat(201)}`);
    expect(response.status).toBe(400);
  });

  it("still says not found, rather than bad request, to a stranger", async () => {
    const seeded = await seedGroup("separate", { expenses: 5, settlements: 1 });
    cookieActor.value = await createTestUser({ name: "Eve" });
    const response = await get(seeded.access.groupId, `?q=${"a".repeat(201)}`);
    expect(response.status).toBe(404);
  });
});
