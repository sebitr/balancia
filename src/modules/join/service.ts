import "server-only";
import { and, asc, count, eq, inArray, isNull, min, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import {
  expenseShares,
  expenses,
  groupMembers,
  groups,
  participants,
} from "@/lib/db/schema";
import { loadGroupBalances } from "@/modules/balances/service";
import { recordActivity } from "@/modules/activity/service";
import { logger } from "@/lib/logger";

/**
 * The join flow's reads and its two mutations.
 *
 * Everything here is deliberately reachable without a group membership: the
 * caller's authority is the join link, checked by the route that set the
 * cookie, and these functions take a `groupId` that only ever comes from
 * resolving that link. None of them take an actor, and none of them consult
 * one — which is exactly why every one of them must stay in this module,
 * where that contract is stated, rather than growing quietly into a shared
 * "group facts" helper that something authenticated also calls.
 *
 * What the link exposes is what the design says it exposes: the group's size
 * and age, the names of people who have no account yet, and what those names
 * owe. That is the price of a link anyone can forward, and the screens say so
 * before showing any of it.
 */

/** What `loadGroupBalances` needs to know about a group to compute it. */
const GROUP_COLUMNS = {
  id: groups.id,
  name: groups.name,
  currencyMode: groups.currencyMode,
  baseCurrency: groups.baseCurrency,
  timezone: groups.timezone,
  archivedAt: groups.archivedAt,
} as const;

/** A face in the invite screen's avatar stack. */
export interface JoinSummaryFace {
  readonly participantId: string;
  readonly displayName: string;
}

export interface JoinSummary {
  readonly groupId: string;
  readonly groupName: string;
  readonly participantCount: number;
  readonly expenseCount: number;
  /** Earliest expense date, ISO. Null in a group with nothing in it yet. */
  readonly since: string | null;
  /** Total tracked per currency, largest first. */
  readonly totals: readonly {
    readonly currency: string;
    readonly amount: bigint;
  }[];
  readonly faces: readonly JoinSummaryFace[];
}

/** How many faces the stack shows before it collapses into a counter. */
const FACE_LIMIT = 3;

/**
 * The group, as much of it as an invite screen should show.
 *
 * Counts rather than contents: how many people, how many expenses, how long it
 * has been running and how much has gone through it. Enough to recognise the
 * group you were told about, not enough to be worth forwarding for.
 */
export async function loadJoinSummary(
  groupId: string,
  options: { db?: Database } = {},
): Promise<JoinSummary> {
  const db = options.db ?? getDb();

  const [group] = await db
    .select(GROUP_COLUMNS)
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);

  if (!group) {
    throw new Error(`Group ${groupId} disappeared while joining`);
  }

  const [people, expenseFacts, balances] = await Promise.all([
    db
      .select({
        id: participants.id,
        displayName: participants.displayName,
      })
      .from(participants)
      .where(
        and(eq(participants.groupId, groupId), isNull(participants.removedAt)),
      )
      .orderBy(asc(participants.createdAt), asc(participants.id)),
    db
      .select({
        total: count(expenses.id),
        since: min(expenses.expenseDate),
      })
      .from(expenses)
      .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt))),
    loadGroupBalances({ groupId, group }),
  ]);

  const totals = [...balances.totalSpend.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));

  return {
    groupId,
    groupName: group.name,
    participantCount: people.length,
    expenseCount: expenseFacts[0]?.total ?? 0,
    since: expenseFacts[0]?.since ?? null,
    totals,
    faces: people.slice(0, FACE_LIMIT).map((person) => ({
      participantId: person.id,
      displayName: person.displayName,
    })),
  };
}

/** One of the last expenses touching a claimable member. */
export interface ClaimableExpense {
  readonly id: string;
  readonly description: string;
  readonly amount: bigint;
  readonly currency: string;
}

export interface ClaimableMember {
  readonly id: string;
  readonly displayName: string;
  /** How many live expenses this member has a share in. */
  readonly expenseCount: number;
  /** Their position per currency; negative owes, positive gets back. */
  readonly balances: readonly {
    readonly currency: string;
    readonly amount: bigint;
  }[];
  readonly recentExpenses: readonly ClaimableExpense[];
}

/** How many expenses the confirmation screen lists under a name. */
const RECENT_EXPENSE_LIMIT = 2;

/**
 * Everyone in the group who has no account yet.
 *
 * These are the only rows a joiner may claim, and the screens say so: someone
 * whose name is already linked to an account is not a name to take over, they
 * are a person to ask for a link. Removed participants are excluded — their
 * history stays where it is.
 *
 * The per-member figures come from one balance computation over the whole
 * group rather than a query each, because the engine has to read every expense
 * anyway to get any single position right.
 */
export async function listClaimableMembers(
  groupId: string,
  options: { db?: Database } = {},
): Promise<readonly ClaimableMember[]> {
  const db = options.db ?? getDb();

  const [group] = await db
    .select(GROUP_COLUMNS)
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);

  if (!group) return [];

  const rows = await db
    .select({ id: participants.id, displayName: participants.displayName })
    .from(participants)
    .where(
      and(
        eq(participants.groupId, groupId),
        isNull(participants.userId),
        isNull(participants.removedAt),
      ),
    )
    .orderBy(asc(participants.createdAt), asc(participants.id));

  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [balances, counts, recent] = await Promise.all([
    loadGroupBalances({ groupId, group }),
    db
      .select({
        participantId: expenseShares.participantId,
        total: count(expenses.id),
      })
      .from(expenseShares)
      .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
      .where(
        and(
          inArray(expenseShares.participantId, ids),
          eq(expenses.groupId, groupId),
          isNull(expenses.deletedAt),
        ),
      )
      .groupBy(expenseShares.participantId),
    // The two most recent per member, decided in SQL: pulling every expense
    // back to slice it in JavaScript is the same query with more bytes.
    db
      .select({
        participantId: expenseShares.participantId,
        id: expenses.id,
        description: expenses.description,
        amount: expenses.amount,
        currency: expenses.currency,
        rank: sql<number>`row_number() over (
          partition by ${expenseShares.participantId}
          order by ${expenses.expenseDate} desc, ${expenses.createdAt} desc
        )`.as("rank"),
      })
      .from(expenseShares)
      .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
      .where(
        and(
          inArray(expenseShares.participantId, ids),
          eq(expenses.groupId, groupId),
          isNull(expenses.deletedAt),
        ),
      ),
  ]);

  const countsById = new Map(
    counts.map((row) => [row.participantId, row.total]),
  );

  const recentById = new Map<string, ClaimableExpense[]>();
  for (const row of recent) {
    if (row.rank > RECENT_EXPENSE_LIMIT) continue;
    const list = recentById.get(row.participantId) ?? [];
    list.push({
      id: row.id,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
    });
    recentById.set(row.participantId, list);
  }

  const positionsById = new Map<
    string,
    { currency: string; amount: bigint }[]
  >();
  for (const currency of balances.currencies) {
    for (const balance of currency.balances) {
      if (balance.amount === 0n) continue;
      const list = positionsById.get(balance.participantId) ?? [];
      list.push({ currency: currency.currency, amount: balance.amount });
      positionsById.set(balance.participantId, list);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    expenseCount: countsById.get(row.id) ?? 0,
    balances: positionsById.get(row.id) ?? [],
    recentExpenses: recentById.get(row.id) ?? [],
  }));
}

/**
 * A join that cannot finish, said in a sentence the joiner can act on.
 *
 * Both reasons are races rather than mistakes — a link revoked while somebody
 * was reading the list, a name claimed by whoever tapped first — so they are
 * refusals to show, not failures to log. The `code` is what `describeError`
 * translates; see `lib/server-errors.ts`.
 */
export class JoinError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "JoinError";
    this.code = code;
  }
}

export type JoinOutcome =
  | { readonly status: "joined"; readonly participantId: string }
  /** Somebody else linked that name first, or it was linked all along. */
  | { readonly status: "taken" }
  /** This account is already in the group; there is nothing to join. */
  | { readonly status: "already-member"; readonly participantId: string };

/**
 * Links an unclaimed participant to a freshly created account.
 *
 * The guard is the `userId IS NULL` in the UPDATE predicate rather than a
 * SELECT before it: two people racing for the same name must not both be told
 * they won, and the database is the only place that can decide. Zero rows
 * updated is the loser, and it is a normal outcome rather than an error.
 */
export async function claimMember(
  input: {
    readonly groupId: string;
    readonly participantId: string;
    readonly userId: string;
  },
  options: { db?: Database; now?: Date } = {},
): Promise<JoinOutcome> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const { groupId, participantId, userId } = input;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(
        and(eq(participants.groupId, groupId), eq(participants.userId, userId)),
      )
      .limit(1);
    if (existing) {
      return { status: "already-member", participantId: existing.id } as const;
    }

    const linked = await tx
      .update(participants)
      .set({ userId, updatedAt: now })
      .where(
        and(
          eq(participants.id, participantId),
          eq(participants.groupId, groupId),
          isNull(participants.userId),
          isNull(participants.removedAt),
        ),
      )
      .returning({
        id: participants.id,
        displayName: participants.displayName,
      });

    if (linked.length === 0) return { status: "taken" } as const;

    await tx
      .insert(groupMembers)
      .values({ groupId, userId, participantId, role: "member" });

    await recordActivity(tx, {
      groupId,
      action: "member.added",
      entityType: "group_member",
      entityId: participantId,
      actorType: "user",
      actorUserId: userId,
      actorParticipantId: participantId,
      actorLabel: linked[0].displayName,
      metadata: { via: "join_link", claimed: true },
    });

    logger.info({ groupId, participantId }, "Join link claimed a member");
    return { status: "joined", participantId } as const;
  });
}

/**
 * Adds the joiner as a new participant with an empty balance.
 *
 * The other half of the fork. Nothing is rewritten and nothing is inherited:
 * past expenses keep the shares they already had, which is why this path needs
 * no confirmation step while claiming does.
 */
export async function createMember(
  input: {
    readonly groupId: string;
    readonly userId: string;
    readonly displayName: string;
  },
  options: { db?: Database; now?: Date } = {},
): Promise<JoinOutcome> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const { groupId, userId, displayName } = input;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(
        and(eq(participants.groupId, groupId), eq(participants.userId, userId)),
      )
      .limit(1);
    if (existing) {
      return { status: "already-member", participantId: existing.id } as const;
    }

    const [created] = await tx
      .insert(participants)
      .values({
        groupId,
        displayName: displayName.trim(),
        userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: participants.id });

    await tx
      .insert(groupMembers)
      .values({ groupId, userId, participantId: created.id, role: "member" });

    await recordActivity(tx, {
      groupId,
      action: "member.added",
      entityType: "group_member",
      entityId: created.id,
      actorType: "user",
      actorUserId: userId,
      actorParticipantId: created.id,
      actorLabel: displayName.trim(),
      metadata: { via: "join_link", claimed: false },
    });

    logger.info({ groupId }, "Join link added a member");
    return { status: "joined", participantId: created.id } as const;
  });
}

/** One claimable member, re-read for the confirmation screen. */
export async function findClaimableMember(
  groupId: string,
  participantId: string,
  options: { db?: Database } = {},
): Promise<ClaimableMember | null> {
  const members = await listClaimableMembers(groupId, options);
  return members.find((member) => member.id === participantId) ?? null;
}

export { FACE_LIMIT, RECENT_EXPENSE_LIMIT };
