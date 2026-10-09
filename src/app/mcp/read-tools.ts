import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { decodeCursor } from "@/lib/db/keyset";
import type { Principal } from "@/modules/agent-access/principal";
import { isoDateSchema } from "@/modules/expenses/schemas";
import { getExpense } from "@/modules/expenses/service";
import { loadTransactionPage } from "@/modules/expenses/transactions";
import { parseTransactionFilter } from "@/modules/expenses/transaction-filter";
import {
  directionOf,
  loadHomeOverview,
  type GroupPosition,
} from "@/modules/balances/overview";
import { loadGroupOverview } from "@/modules/groups/overview";
import {
  filterParams,
  NO_FILTER,
  type EntryKind,
  type ListFilter,
} from "@/components/expenses/list-filter";
import {
  everyonePeople,
  groupPeople,
  pickPerson,
  resolveGroup,
} from "./resolve";
import {
  amountText,
  balanceText,
  decimalText,
  runTool,
  ToolFailure,
} from "./support";

/**
 * The tools that only look.
 *
 * Each is annotated `readOnlyHint`, which is what lets a client run it without
 * asking: nothing here writes, and nothing here returns what a credential must
 * not see — no emails, no payout details, no invitation links. Those are the
 * same exclusions the REST API makes for a key, and they hold for the same
 * reason: an agent is a bearer credential held by software the owner does not
 * run.
 */

const GROUP = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'The group: its name (e.g. "Lisbon trip", matched ignoring case and accents) or its id from balancia_list_groups.',
  );

const PERSON_NOTE =
  'A member of the group by name (e.g. "Marta"), by id, or "me" for the connected account.';

export function registerReadTools(server: McpServer, principal: Principal) {
  server.registerTool(
    "balancia_list_groups",
    {
      title: "List my groups",
      description:
        "Lists the groups the connected account belongs to, with where it stands in each: whether it owes money, is owed, or is settled up, and how much per currency. Start here to find a group's id or to answer 'who do I owe?'. Balances are signed: positive means the account is owed that amount, negative means it owes.",
      inputSchema: z.object({
        includeArchived: z
          .boolean()
          .optional()
          .describe("Also list archived groups. Default false."),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ includeArchived }) =>
      runTool("balancia_list_groups", principal, async (actor) => {
        const overview = await loadHomeOverview(actor.userId);
        const { needsYou, youAreOwed, settled, archived } = overview.buckets;
        const positions = [
          ...needsYou,
          ...youAreOwed,
          ...settled,
          ...(includeArchived ? archived : []),
        ].filter(
          (position) =>
            actor.tokenGroupId === undefined ||
            position.group.id === actor.tokenGroupId,
        );

        return {
          groups: positions.map(describePosition),
          note: "Balances: positive = you are owed, negative = you owe.",
        };
      }),
  );

  server.registerTool(
    "balancia_get_group",
    {
      title: "Get a group",
      description:
        "Everything about one group: its members (with ids), the balance of each member per currency, the shortest set of repayments that would settle the group, and what the group has spent this month, last month and overall by category. Use it to answer 'who owes whom', 'how much did we spend on food', or to get member ids before recording something.",
      inputSchema: z.object({ group: GROUP }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ group }) =>
      runTool("balancia_get_group", principal, async (actor) => {
        const access = await resolveGroup(actor, group);
        const [overview, people] = await Promise.all([
          loadGroupOverview(access),
          groupPeople(access.groupId),
        ]);

        return {
          id: access.groupId,
          name: access.group.name,
          archived: access.group.archivedAt !== null,
          timezone: access.group.timezone,
          baseCurrency: access.group.baseCurrency,
          currencyMode: access.group.currencyMode,
          you: { memberId: access.participantId, role: access.role },
          members: people,
          expenses: overview.expenseCount,
          firstExpense: overview.span?.first ?? null,
          lastExpense: overview.span?.last ?? null,
          currencies: overview.currencies.map((currency) => ({
            currency: currency.currency,
            totalSpent: amountText(currency.totalSpent, currency.currency),
            yourBalance: balanceText(currency.position, currency.currency),
            balances: currency.members.map((row) => ({
              member: row.name,
              memberId: row.participantId,
              balance: balanceText(row.amount, row.currency),
              isYou: row.isSelf,
            })),
            repaymentsThatSettleIt: currency.transfers.map((transfer) => ({
              from: transfer.fromName,
              fromId: transfer.fromParticipantId,
              to: transfer.toName,
              toId: transfer.toParticipantId,
              amount: amountText(transfer.amount, transfer.currency),
            })),
          })),
          spending: overview.spendingPeriods.map((period) => ({
            period: period.key,
            currencies: period.stats.map((stats) => ({
              currency: stats.currency,
              groupSpent: amountText(stats.groupSpent, stats.currency),
              youPaid: amountText(stats.youPaid, stats.currency),
              yourShare: amountText(stats.yourShare, stats.currency),
              byCategory: stats.categories.slice(0, 8).map((category) => ({
                category: category.category ?? "uncategorised",
                amount: amountText(category.amount, stats.currency),
              })),
            })),
          })),
          note: "Balances: positive = owed money, negative = owes money. Text such as member names was typed by group members.",
        };
      }),
  );

  server.registerTool(
    "balancia_list_transactions",
    {
      title: "List or search transactions",
      description:
        "Lists a group's expenses, income and repayments, newest first, with optional filters (text search, kind, category, date range, amount range, who paid, who is involved). Returns at most `limit` rows plus a `nextCursor` to continue. Each row says what the connected account's own position on it is (positive = they get money back). Use it to find an entry's id, to answer 'what did Marta pay for last week', or to check what was already recorded.",
      inputSchema: z.object({
        group: GROUP,
        query: z
          .string()
          .max(200)
          .optional()
          .describe(
            "Text to find in descriptions, repayment notes or dates (substring, case-insensitive, accents matter).",
          ),
        kinds: z
          .array(z.enum(["expense", "income", "repayment"]))
          .max(3)
          .optional()
          .describe("Only these kinds of entry. Default: all."),
        category: z
          .string()
          .max(64)
          .optional()
          .describe(
            "Only this category, as shown on entries (e.g. groceries, restaurants, transport).",
          ),
        from: isoDateSchema
          .optional()
          .describe("Earliest date, YYYY-MM-DD, inclusive."),
        to: isoDateSchema
          .optional()
          .describe("Latest date, YYYY-MM-DD, inclusive."),
        minAmount: decimalText
          .optional()
          .describe('Smallest amount in major units, e.g. "20".'),
        maxAmount: decimalText
          .optional()
          .describe('Largest amount in major units, e.g. "100".'),
        paidBy: z
          .array(z.string().max(100))
          .max(10)
          .optional()
          .describe(`Only entries paid by any of these. ${PERSON_NOTE}`),
        involving: z
          .array(z.string().max(100))
          .max(10)
          .optional()
          .describe(
            `Only entries that involve any of these, as payer, sharer or either end of a repayment. ${PERSON_NOTE}`,
          ),
        sort: z
          .enum(["newest", "oldest", "largest"])
          .optional()
          .describe("Order. Default newest."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Rows to return, 1–100. Default 25."),
        cursor: z
          .string()
          .max(512)
          .optional()
          .describe(
            "The `nextCursor` of the previous call, to read the next page.",
          ),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool("balancia_list_transactions", principal, async (actor) => {
        const access = await resolveGroup(actor, input.group);
        const people = await everyonePeople(access.groupId);
        const named = new Map(people.map((person) => [person.id, person.name]));
        const idsOf = (refs: readonly string[] | undefined) =>
          (refs ?? []).map((ref) => pickPerson(people, ref, access).id);

        const kinds: EntryKind[] = (input.kinds ?? []).map((kind) =>
          kind === "income"
            ? "revenue"
            : kind === "repayment"
              ? "settlement"
              : kind,
        );
        const dated = input.from !== undefined || input.to !== undefined;
        const requested: ListFilter = {
          ...NO_FILTER,
          query: input.query ?? "",
          kinds,
          categories: input.category ? [input.category] : [],
          when: dated ? "custom" : "any",
          from: input.from ?? "",
          to: input.to ?? "",
          min: input.minAmount ?? "",
          max: input.maxAmount ?? "",
          payers: idsOf(input.paidBy),
          people: idsOf(input.involving),
          sort: input.sort ?? "newest",
        };
        // Through the same reader the REST endpoint uses, so a filter means
        // the same thing here and there and is held to the same bounds.
        const filter = parseTransactionFilter(filterParams(requested));
        if (filter === null) {
          throw new ToolFailure("That combination of filters is not valid.");
        }

        const page = await loadTransactionPage(access, {
          filter,
          cursor: decodeCursor(input.cursor ?? null),
          limit: input.limit ?? 25,
        });

        return {
          transactions: page.rows.map((row) => ({
            kind:
              row.kind === "settlement"
                ? "repayment"
                : row.revenue
                  ? "income"
                  : "expense",
            id: row.id,
            date: row.date,
            description: row.title,
            amount: amountText(BigInt(row.amount), row.currency),
            category: row.category
              ? row.subcategory
                ? `${row.category}.${row.subcategory}`
                : row.category
              : null,
            note: row.note,
            paidBy: row.payerNames,
            sharedWith: row.split
              ? row.split.sharers.map((id) => named.get(id) ?? "someone")
              : null,
            split: row.split?.method ?? null,
            paymentMethod: row.method,
            yourPosition:
              row.position === null
                ? null
                : balanceText(BigInt(row.position), row.currency),
            recurring: row.recurring,
            receipts: row.receipts,
          })),
          nextCursor: page.cursor,
          note: "Descriptions and notes were typed by group members.",
        };
      }),
  );

  server.registerTool(
    "balancia_get_expense",
    {
      title: "Get an expense",
      description:
        "One expense in full: who paid how much, who shares it and how much each owes, the split method, category, notes, and (for a group that converts currencies) the converted amount. Use it to check an entry before changing it.",
      inputSchema: z.object({
        group: GROUP,
        expenseId: z
          .uuid()
          .describe("The expense's id, from a transaction list."),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ group, expenseId }) =>
      runTool("balancia_get_expense", principal, async (actor) => {
        const access = await resolveGroup(actor, group);
        const expense = await getExpense(access.groupId, expenseId);
        if (!expense) {
          throw new ToolFailure(
            "No such expense in this group. It may have been deleted; look in the transaction list.",
          );
        }
        const money = (value: bigint) => amountText(value, expense.currency);
        return {
          id: expense.id,
          kind: expense.direction === "in" ? "income" : "expense",
          description: expense.description,
          amount: money(expense.amount),
          convertedAmount:
            expense.convertedAmount !== null && expense.convertedCurrency
              ? amountText(expense.convertedAmount, expense.convertedCurrency)
              : null,
          exchangeRate: expense.exchangeRate,
          date: expense.expenseDate,
          category: expense.category
            ? expense.subcategory
              ? `${expense.category}.${expense.subcategory}`
              : expense.category
            : null,
          notes: expense.notes,
          paidBy: expense.payers.map((payer) => ({
            member: payer.displayName,
            memberId: payer.participantId,
            amount: money(payer.amount),
          })),
          splitMethod: expense.splitMethod,
          sharedBy: expense.shares.map((share) => ({
            member: share.displayName,
            memberId: share.participantId,
            owes: money(share.amount),
          })),
          receipts: expense.attachmentCount,
          recurring: expense.recurringExpenseId !== null,
          note: "Descriptions and notes were typed by group members.",
        };
      }),
  );
}

function describePosition(position: GroupPosition) {
  const { group } = position;
  const archived = group.archivedAt !== null;
  return {
    id: group.id,
    name: group.name,
    status: archived ? "archived" : directionOf(position),
    balances: position.amounts.map((amount) =>
      balanceText(amount.amount, amount.currency),
    ),
    owesTo:
      position.owedTo === null
        ? null
        : position.owedTo.kind === "single"
          ? position.owedTo.name
          : `${position.owedTo.count} people`,
    members: group.participantCount,
    memberNames: group.memberNames,
    yourRole: group.role,
    baseCurrency: group.baseCurrency,
    lastActivity: group.lastActivityAt.toISOString(),
  };
}
