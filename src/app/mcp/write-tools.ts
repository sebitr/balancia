import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { activityEvents, expenses, settlements } from "@/lib/db/schema";
import type { GroupAccess } from "@/lib/security/authorization";
import type { Principal } from "@/modules/agent-access/principal";
import {
  classifyTransactionSync,
  EXPENSE_CATEGORIES,
} from "@/modules/categorization";
import { loadMappings } from "@/modules/categorization/service";
import { lookupRate } from "@/modules/currencies/rates";
import { parseMajorAmount } from "@/modules/currencies/money";
import {
  currencyCodeSchema,
  expenseInputSchema,
  isoDateSchema,
  settlementInputSchema,
  type ExpenseInput,
  type SettlementInput,
} from "@/modules/expenses/schemas";
import {
  createExpense,
  deleteExpense,
  getExpense,
  restoreExpense,
  updateExpense,
} from "@/modules/expenses/service";
import { todayIn } from "@/modules/recurring/schedule";
import {
  createSettlement,
  deleteSettlement,
  restoreSettlement,
} from "@/modules/settlements/service";
import { groupPeople, pickPerson, resolveGroup, type Person } from "./resolve";
import {
  amountText,
  decimalText,
  requireWrite,
  runTool,
  ToolFailure,
} from "./support";

/**
 * The tools that change something.
 *
 * Each one is a thin shape around a service that already exists and already
 * decides who may do what — `createExpense` checks the `addExpense` permission,
 * `updateExpense` the `editAnyExpense` one, and a group-pinned or archived
 * group refuses before either runs. What these tools add is a vocabulary a
 * model can use without a table of UUIDs and minor units: names for people,
 * decimal amounts, today's date as a default, and a category chosen the way the
 * web form chooses one.
 *
 * Three habits run through all of them, because the failure they prevent is the
 * one that costs money:
 *
 *  - **Nothing is guessed.** A name that fits two members is an error that lists
 *    both. An amount with more decimals than its currency has is refused, not
 *    rounded. A currency the group cannot convert is asked for, not assumed.
 *  - **A repeat is noticed.** Models retry; networks drop. An entry identical to
 *    one written minutes ago is refused once, with a way to say "yes, I mean
 *    another" — so a retried call cannot quietly double somebody's debt.
 *  - **Everything can be taken back.** Deleting is a soft delete, and
 *    `balancia_restore_entry` undoes it, balances and all.
 */

const GROUP = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'The group: its name (e.g. "Lisbon trip") or its id from balancia_list_groups.',
  );

const WHO =
  'A member of the group by name (e.g. "Marta"), by id, or "me" for the connected account.';

const AMOUNT = decimalText.describe(
  'In major units as a decimal: "63.90", "1200", "7.5". Never cents, never a currency symbol.',
);

const CURRENCY = z
  .string()
  .trim()
  .length(3)
  .optional()
  .describe(
    "ISO 4217 code, e.g. EUR. Defaults to the group's own currency; required when the group has none.",
  );

const DATE = isoDateSchema
  .optional()
  .describe("YYYY-MM-DD. Defaults to today in the group's timezone.");

const CATEGORIES = Object.keys(EXPENSE_CATEGORIES) as [string, ...string[]];

/** How long after writing an entry an identical one counts as a repeat. */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

const customSplit = z
  .object({
    method: z
      .enum(["exact", "percentage", "shares"])
      .describe(
        "exact: each person's amount in major units. percentage: percent each (must total 100). shares: relative weights, e.g. 2 and 1.",
      ),
    entries: z
      .array(
        z.object({
          who: z.string().min(1).max(100).describe(WHO),
          value: decimalText.describe(
            'The amount ("20.00"), the percent ("40") or the weight ("2"), depending on the method.',
          ),
        }),
      )
      .min(1)
      .max(50),
  })
  .describe(
    "An unequal split. Use splitBetween instead for the common case of sharing equally.",
  );

export function registerWriteTools(server: McpServer, principal: Principal) {
  server.registerTool(
    "balancia_add_expense",
    {
      title: "Add an expense",
      description:
        'Records a new expense in a group: who paid and how it is shared. By default the connected account paid and it is split equally between everyone in the group. The other members are notified. Check the details with the person before calling if anything is unclear — who paid, who shares, the amount. If an identical expense was added in the last ten minutes this refuses once, unless allowDuplicate is true. For "Marta paid me back", use balancia_record_repayment instead.',
      inputSchema: z.object({
        group: GROUP,
        description: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe('What it was for, e.g. "Dinner at Taberna".'),
        amount: AMOUNT.describe(
          'The total in major units as a decimal: "63.90". Never cents, never a currency symbol.',
        ),
        currency: CURRENCY,
        date: DATE,
        paidBy: z
          .string()
          .max(100)
          .optional()
          .describe(`Who paid it all. ${WHO} Default "me".`),
        payers: z
          .array(
            z.object({
              who: z.string().min(1).max(100).describe(WHO),
              amount: AMOUNT,
            }),
          )
          .min(1)
          .max(20)
          .optional()
          .describe(
            "When several people each paid part. The amounts must add up to the total. Overrides paidBy.",
          ),
        splitBetween: z
          .array(z.string().min(1).max(100))
          .min(1)
          .max(50)
          .optional()
          .describe(
            `Share the cost equally between these people (each a member as described: ${WHO}). Default: everyone in the group.`,
          ),
        customSplit: customSplit.optional(),
        category: z
          .string()
          .max(60)
          .optional()
          .describe(
            `One of: ${CATEGORIES.join(", ")}. Omit it and Balancia chooses from the description when it is confident.`,
          ),
        notes: z.string().max(2000).optional(),
        exchangeRate: decimalText
          .optional()
          .describe(
            "Only for a group that converts currencies, when the expense is in another currency: 1 unit of the expense currency = this many units of the group's currency. Looked up if omitted.",
          ),
        allowDuplicate: z
          .boolean()
          .optional()
          .describe(
            "Set true only when the person really wants a second identical expense.",
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (input) =>
      runTool("balancia_add_expense", principal, async (actor) => {
        requireWrite(principal);
        const access = await resolveGroup(actor, input.group, {
          requireActive: true,
        });
        const people = await groupPeople(access.groupId);
        const built = await buildExpense(access, people, input);

        if (!input.allowDuplicate) {
          const twin = await recentTwin(access.groupId, built);
          if (twin) {
            throw new ToolFailure(
              `An identical expense ("${twin.description}", ${amountText(twin.amount, twin.currency)}, ${twin.expenseDate}) was added a few minutes ago (id ${twin.id}). Nothing was added. If the person really wants another, call again with allowDuplicate: true.`,
            );
          }
        }

        const id = await createExpense(access, built);
        return {
          created: await describeExpense(access.groupId, id),
          groupNotified: true,
          undo: `balancia_delete_entry with kind "expense" and id ${id}`,
        };
      }),
  );

  server.registerTool(
    "balancia_update_expense",
    {
      title: "Change an expense",
      description:
        "Changes an existing expense. Only the fields you pass change; everything else stays as it was. Passing paidBy, splitBetween or customSplit replaces who paid or how it is shared. If somebody else changes the expense in the moment between this tool reading it and writing it, this refuses and nothing is written; call it again. Get the expense id from balancia_list_transactions. Members are notified of the change.",
      inputSchema: z.object({
        group: GROUP,
        expenseId: z.uuid().describe("The expense's id."),
        description: z.string().trim().min(1).max(200).optional(),
        amount: AMOUNT.optional(),
        currency: CURRENCY,
        date: DATE,
        paidBy: z
          .string()
          .max(100)
          .optional()
          .describe(`Replace the payer with one person. ${WHO}`),
        splitBetween: z
          .array(z.string().min(1).max(100))
          .min(1)
          .max(50)
          .optional()
          .describe(
            "Replace the split with an equal split between these people.",
          ),
        customSplit: customSplit.optional(),
        category: z
          .string()
          .max(60)
          .optional()
          .describe(`One of: ${CATEGORIES.join(", ")}.`),
        notes: z.string().max(2000).optional(),
        exchangeRate: decimalText.optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) =>
      runTool("balancia_update_expense", principal, async (actor) => {
        requireWrite(principal);
        const access = await resolveGroup(actor, input.group, {
          requireActive: true,
        });
        const current = await getExpense(access.groupId, input.expenseId);
        if (!current) {
          throw new ToolFailure(
            "No such expense in this group. It may have been deleted.",
          );
        }
        const people = await groupPeople(access.groupId);

        const currency = input.currency
          ? currencyCodeSchema.parse(input.currency)
          : current.currency;
        // The stored amount is minor units of the stored currency. Read under
        // another currency it is a different sum — 1000 yen is 10.00 euros —
        // so a new currency has to come with the amount in it.
        const currencyChanged = currency !== current.currency;
        if (currencyChanged && input.amount === undefined) {
          throw new ToolFailure(
            `This expense is in ${current.currency}. To change its currency to ${currency}, give the amount in ${currency} as well; it is not converted.`,
          );
        }
        const amount =
          input.amount === undefined
            ? current.amount
            : majorAmount(input.amount, currency, "amount");
        const amountChanged = currencyChanged || amount !== current.amount;
        const date = input.date ?? current.expenseDate;

        // Who paid. Replaced outright, or carried over — and when the total
        // moved, a lone payer carries it with them, because there is no other
        // reading. Several payers and a new total have no single right answer.
        let payers: ExpenseInput["payers"];
        if (input.paidBy !== undefined) {
          payers = [
            {
              participantId: pickPerson(people, input.paidBy, access, "payer")
                .id,
              amount: amount.toString(),
            },
          ];
        } else if (!amountChanged) {
          payers = current.payers.map((payer) => ({
            participantId: payer.participantId,
            amount: payer.amount.toString(),
          }));
        } else if (current.payers.length === 1) {
          payers = [
            {
              participantId: current.payers[0]!.participantId,
              amount: amount.toString(),
            },
          ];
        } else {
          throw new ToolFailure(
            "This expense was paid by several people, so changing the amount needs to say who paid what. Delete and re-add it with balancia_add_expense and `payers`.",
          );
        }

        // How it is shared. Replaced, or carried over as it was stored. An
        // exact split is in amounts, so a new total makes it meaningless.
        let split: Pick<ExpenseInput, "splitMethod" | "splitEntries">;
        if (input.customSplit || input.splitBetween) {
          split = await splitFrom(input, people, access, currency);
        } else {
          const stored = current.splitInput;
          if (stored?.method === "exact" && amountChanged) {
            throw new ToolFailure(
              "This expense is split by exact amounts, so changing the total needs a new split: pass splitBetween (equal) or customSplit.",
            );
          }
          split = stored
            ? {
                splitMethod: stored.method,
                splitEntries: stored.entries.map((entry) => ({
                  participantId: entry.participantId,
                  ...(entry.value === undefined ? {} : { value: entry.value }),
                })),
              }
            : {
                splitMethod: "equal",
                splitEntries: current.shares.map((share) => ({
                  participantId: share.participantId,
                })),
              };
        }

        // Left alone unless the caller names one: an edit that fixes a typo in
        // the description is not a reason to refile the expense.
        const keepsCategory = input.category === undefined;
        const category = keepsCategory
          ? null
          : await chosenCategory(access, {
              requested: input.category,
              description: input.description ?? current.description,
              notes: input.notes ?? current.notes ?? undefined,
            });

        // A converted group's rate is frozen on the expense. Keep it while the
        // currency and day stand; look a new one up when either moves.
        const rateStands =
          currency === current.currency && date === current.expenseDate;
        const exchangeRate =
          input.exchangeRate ??
          (rateStands
            ? (current.exchangeRate ?? undefined)
            : await suggestedRate(access, currency, date));

        const next = expenseInputSchema.parse({
          direction: current.direction,
          description: input.description ?? current.description,
          notes: input.notes ?? current.notes ?? "",
          category: keepsCategory
            ? (current.category ?? "")
            : (category?.category ?? ""),
          subcategory: keepsCategory
            ? (current.subcategory ?? "")
            : (category?.subcategory ?? ""),
          amount: amount.toString(),
          currency,
          exchangeRate,
          expenseDate: date,
          payers,
          ...split,
        });

        await updateExpense(access, input.expenseId, next, {
          expectedVersion: current.version,
        });
        return {
          updated: await describeExpense(access.groupId, input.expenseId),
          groupNotified: true,
        };
      }),
  );

  server.registerTool(
    "balancia_record_repayment",
    {
      title: "Record a repayment",
      description:
        'Records that one member paid money to another to settle a debt — "Marta paid me back 20 euros", "I gave Ben 50". It is not an expense: it moves balances without counting as spending. The person it is paid to is notified. Use balancia_get_group first to see who owes whom. If an identical repayment was recorded in the last ten minutes this refuses once, unless allowDuplicate is true.',
      inputSchema: z.object({
        group: GROUP,
        from: z.string().min(1).max(100).describe(`Who paid the money. ${WHO}`),
        to: z.string().min(1).max(100).describe(`Who received it. ${WHO}`),
        amount: AMOUNT,
        currency: CURRENCY,
        date: DATE,
        paymentMethod: z
          .string()
          .max(60)
          .optional()
          .describe('How it was paid, e.g. "cash", "bank transfer", "PayPal".'),
        notes: z.string().max(2000).optional(),
        exchangeRate: decimalText.optional(),
        allowDuplicate: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (input) =>
      runTool("balancia_record_repayment", principal, async (actor) => {
        requireWrite(principal);
        const access = await resolveGroup(actor, input.group, {
          requireActive: true,
        });
        const people = await groupPeople(access.groupId);
        const from = pickPerson(people, input.from, access, "payer");
        const to = pickPerson(people, input.to, access, "recipient");
        const currency = resolveCurrency(access, input.currency);
        const date = input.date ?? todayIn(access.group.timezone);
        const amount = majorAmount(input.amount, currency, "amount");

        const built: SettlementInput = settlementInputSchema.parse({
          fromParticipantId: from.id,
          toParticipantId: to.id,
          amount: amount.toString(),
          currency,
          exchangeRate:
            input.exchangeRate ?? (await suggestedRate(access, currency, date)),
          settledOn: date,
          paymentMethod: input.paymentMethod ?? "",
          notes: input.notes ?? "",
        });

        if (!input.allowDuplicate) {
          const twin = await recentRepaymentTwin(access.groupId, built);
          if (twin) {
            throw new ToolFailure(
              `An identical repayment (${from.name} → ${to.name}, ${amountText(twin.amount, twin.currency)}, ${twin.settledOn}) was recorded a few minutes ago (id ${twin.id}). Nothing was added. If it really happened twice, call again with allowDuplicate: true.`,
            );
          }
        }

        const id = await createSettlement(access, built);
        return {
          created: {
            id,
            kind: "repayment",
            from: from.name,
            to: to.name,
            amount: amountText(amount, currency),
            date,
            paymentMethod: input.paymentMethod ?? null,
          },
          recipientNotified: true,
          undo: `balancia_delete_entry with kind "repayment" and id ${id}`,
        };
      }),
  );

  server.registerTool(
    "balancia_delete_entry",
    {
      title: "Delete an expense or repayment",
      description:
        "Deletes an expense or a repayment from a group. Balances change as if it never existed. Members are notified. It is a soft delete: balancia_restore_entry puts it back exactly as it was. Get the id from balancia_list_transactions, and confirm with the person which entry they mean before deleting.",
      inputSchema: z.object({
        group: GROUP,
        kind: z.enum(["expense", "repayment"]),
        id: z.uuid().describe("The entry's id."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ group, kind, id }) =>
      runTool("balancia_delete_entry", principal, async (actor) => {
        requireWrite(principal);
        const access = await resolveGroup(actor, group, {
          requireActive: true,
        });
        if (kind === "expense") await deleteExpense(access, id);
        else await deleteSettlement(access, id);
        return {
          deleted: { kind, id },
          undo: `balancia_restore_entry with kind "${kind}" and id ${id}`,
        };
      }),
  );

  server.registerTool(
    "balancia_restore_entry",
    {
      title: "Restore a deleted entry",
      description:
        "Puts back an expense or repayment that was deleted, with its payers, shares and balances exactly as they were. Use it to undo balancia_delete_entry. An entry that is not deleted cannot be restored.",
      inputSchema: z.object({
        group: GROUP,
        kind: z.enum(["expense", "repayment"]),
        id: z.uuid().describe("The deleted entry's id."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ group, kind, id }) =>
      runTool("balancia_restore_entry", principal, async (actor) => {
        requireWrite(principal);
        const access = await resolveGroup(actor, group, {
          requireActive: true,
        });
        await assertNotReplaced(access.groupId, kind, id);
        if (kind === "expense") await restoreExpense(access, id);
        else await restoreSettlement(access, id);
        return { restored: { kind, id } };
      }),
  );
}

/* ------------------------------------------------------------------ */

type AddInput = {
  description: string;
  amount: string;
  currency?: string | undefined;
  date?: string | undefined;
  paidBy?: string | undefined;
  payers?: { who: string; amount: string }[] | undefined;
  splitBetween?: string[] | undefined;
  customSplit?: z.infer<typeof customSplit> | undefined;
  category?: string | undefined;
  notes?: string | undefined;
  exchangeRate?: string | undefined;
};

/** The group's currency, or the one the caller named — never a guess. */
function resolveCurrency(
  access: GroupAccess,
  named: string | undefined,
): string {
  const currency = named ?? access.group.baseCurrency;
  if (!currency) {
    throw new ToolFailure(
      "This group has no default currency. Say which currency the amount is in (e.g. EUR).",
    );
  }
  return currencyCodeSchema.parse(currency);
}

/** A decimal in major units as minor units, refusing more precision than the currency has. */
function majorAmount(text: string, currency: string, what: string): bigint {
  const parsed = parseMajorAmount(text, currency).amount;
  if (parsed <= 0n)
    throw new ToolFailure(`The ${what} must be more than zero.`);
  return parsed;
}

/**
 * The rate for a foreign-currency entry in a group that converts, or undefined
 * when none is needed. Looked up the way the web form does, and asked for when
 * the lookup has nothing — a rate is money, and inventing one is not an option.
 */
async function suggestedRate(
  access: GroupAccess,
  currency: string,
  on: string,
): Promise<string | undefined> {
  const base = access.group.baseCurrency;
  if (access.group.currencyMode !== "converted" || !base || currency === base) {
    return undefined;
  }
  const quote = await lookupRate({ from: currency, to: base, on });
  if (!quote) {
    throw new ToolFailure(
      `This group keeps its books in ${base} and no rate for ${currency} could be looked up. Pass exchangeRate: how many ${base} one ${currency} is worth.`,
    );
  }
  return quote.rate;
}

/** The category to file under: the one named, else the one the classifier is sure of. */
async function chosenCategory(
  access: GroupAccess,
  input: {
    requested: string | undefined;
    description: string;
    notes: string | undefined;
  },
): Promise<{ category: string; subcategory?: string } | null> {
  if (input.requested !== undefined && input.requested.trim() !== "") {
    const wanted = input.requested.trim().toLowerCase();
    const known = CATEGORIES.find((code) => code === wanted);
    if (!known) {
      throw new ToolFailure(
        `"${input.requested}" is not a category. Use one of: ${CATEGORIES.join(", ")} — or leave it out.`,
      );
    }
    return { category: known };
  }
  if (input.requested !== undefined) return null;

  const mappings = await loadMappings(access);
  const result = classifyTransactionSync(
    { description: input.description, note: input.notes },
    { mappings },
  );
  // Only what the web form would fill in without asking.
  if (result.decision !== "auto_assigned" || !result.category) return null;
  return {
    category: result.category,
    ...(result.subcategory ? { subcategory: result.subcategory } : {}),
  };
}

async function splitFrom(
  input: {
    splitBetween?: string[] | undefined;
    customSplit?: z.infer<typeof customSplit> | undefined;
  },
  people: readonly Person[],
  access: Pick<GroupAccess, "participantId">,
  currency: string,
): Promise<Pick<ExpenseInput, "splitMethod" | "splitEntries">> {
  if (input.customSplit && input.splitBetween) {
    throw new ToolFailure("Pass splitBetween or customSplit, not both.");
  }
  if (input.customSplit) {
    const { method, entries } = input.customSplit;
    return {
      splitMethod: method,
      splitEntries: entries.map((entry) => ({
        participantId: pickPerson(people, entry.who, access).id,
        value:
          method === "exact"
            ? parseMajorAmount(entry.value, currency).amount.toString()
            : entry.value,
      })),
    };
  }
  const chosen = input.splitBetween
    ? input.splitBetween.map((who) => pickPerson(people, who, access))
    : [...people];
  const unique = [
    ...new Map(chosen.map((person) => [person.id, person])).values(),
  ];
  return {
    splitMethod: "equal",
    splitEntries: unique.map((person) => ({ participantId: person.id })),
  };
}

async function buildExpense(
  access: GroupAccess,
  people: readonly Person[],
  input: AddInput,
): Promise<ExpenseInput> {
  const currency = resolveCurrency(access, input.currency);
  const date = input.date ?? todayIn(access.group.timezone);
  const total = majorAmount(input.amount, currency, "amount");

  const payers = input.payers
    ? input.payers.map((payer) => ({
        participantId: pickPerson(people, payer.who, access, "payer").id,
        amount: majorAmount(payer.amount, currency, "payer amount").toString(),
      }))
    : [
        {
          participantId: pickPerson(
            people,
            input.paidBy ?? "me",
            access,
            "payer",
          ).id,
          amount: total.toString(),
        },
      ];

  const split = await splitFrom(input, people, access, currency);
  const category = await chosenCategory(access, {
    requested: input.category,
    description: input.description,
    notes: input.notes,
  });

  return expenseInputSchema.parse({
    description: input.description,
    notes: input.notes ?? "",
    category: category?.category ?? "",
    subcategory: category?.subcategory ?? "",
    amount: total.toString(),
    currency,
    exchangeRate:
      input.exchangeRate ?? (await suggestedRate(access, currency, date)),
    expenseDate: date,
    payers,
    ...split,
  });
}

/**
 * An expense written in the last few minutes that says the same thing.
 *
 * Asked of the table directly, by when it was *written*. The list the screens
 * read is ordered by the day an expense is *for*, so "the last twenty" is the
 * twenty with the latest dates — and a retried entry dated last month, in a
 * group with a busy week since, is not among them. The candidates here are the
 * rows that match on everything but the words, so there are few, and the words
 * are compared in JavaScript where case folding means what it means everywhere
 * else.
 */
async function recentTwin(groupId: string, built: ExpenseInput) {
  const written = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const candidates = await getDb()
    .select({
      id: expenses.id,
      description: expenses.description,
      amount: expenses.amount,
      currency: expenses.currency,
      expenseDate: expenses.expenseDate,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, groupId),
        isNull(expenses.deletedAt),
        gte(expenses.createdAt, written),
        eq(expenses.amount, BigInt(built.amount)),
        eq(expenses.currency, built.currency),
        eq(expenses.expenseDate, built.expenseDate),
      ),
    );
  const wanted = built.description.trim().toLowerCase();
  return candidates.find(
    (expense) => expense.description.trim().toLowerCase() === wanted,
  );
}

async function recentRepaymentTwin(groupId: string, built: SettlementInput) {
  const written = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const [twin] = await getDb()
    .select({
      id: settlements.id,
      amount: settlements.amount,
      currency: settlements.currency,
      settledOn: settlements.settledOn,
    })
    .from(settlements)
    .where(
      and(
        eq(settlements.groupId, groupId),
        isNull(settlements.deletedAt),
        gte(settlements.createdAt, written),
        eq(settlements.amount, BigInt(built.amount)),
        eq(settlements.currency, built.currency),
        eq(settlements.settledOn, built.settledOn),
        eq(settlements.fromParticipantId, built.fromParticipantId),
        eq(settlements.toParticipantId, built.toParticipantId),
      ),
    )
    .limit(1);
  return twin;
}

/**
 * Refuses to put back an entry that was deleted because it was replaced.
 *
 * Changing an expense into a repayment, or the other way, writes the new entry
 * and deletes the old one, and the deletion records which entry replaced it.
 * The Activity screen knows and does not offer a restore for that line. The
 * services do not check, and a restore from here would leave both alive: the
 * same money counted twice. Guarded in the tool rather than in the services,
 * which the web app and the REST API share, and which are not this change's to
 * alter — the REST `/restore` routes have the gap too.
 */
async function assertNotReplaced(
  groupId: string,
  kind: "expense" | "repayment",
  id: string,
): Promise<void> {
  const [deletion] = await getDb()
    .select({ metadata: activityEvents.metadata })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.groupId, groupId),
        eq(
          activityEvents.action,
          kind === "expense" ? "expense.deleted" : "settlement.deleted",
        ),
        eq(activityEvents.entityId, id),
      ),
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(1);
  const metadata = deletion?.metadata as { replacedBy?: unknown } | null;
  if (metadata && typeof metadata.replacedBy === "string") {
    throw new ToolFailure(
      "That entry was not deleted: somebody changed its type and it was replaced by another entry. Putting it back would count the money twice. Look in balancia_list_transactions for the entry that replaced it.",
    );
  }
}

/** The expense as it now stands, in the shape the read tools use. */
async function describeExpense(groupId: string, expenseId: string) {
  const expense = await getExpense(groupId, expenseId);
  if (!expense) return { id: expenseId };
  const money = (value: bigint) => amountText(value, expense.currency);
  return {
    id: expense.id,
    description: expense.description,
    amount: money(expense.amount),
    date: expense.expenseDate,
    category: expense.category,
    paidBy: expense.payers.map((payer) => ({
      member: payer.displayName,
      amount: money(payer.amount),
    })),
    splitMethod: expense.splitMethod,
    sharedBy: expense.shares.map((share) => ({
      member: share.displayName,
      owes: money(share.amount),
    })),
  };
}
