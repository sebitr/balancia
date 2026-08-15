import "server-only";
import { and, desc, eq, or } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { expenseCategoryMappings } from "@/lib/db/schema";
import type { GroupAccess } from "@/lib/security/authorization";
import { learningKeyFor, planCorrection } from "./learning";
import { normalizeMerchant } from "./normalize";
import {
  isExpenseCategory,
  isTransactionType,
  type ExpenseCategory,
  type LearnedMerchantMapping,
  type MappingScope,
  type TransactionType,
} from "./types";

/**
 * Persistence for learned merchant mappings.
 *
 * The only part of categorization that touches PostgreSQL. Everything a
 * mapping *means* is decided in `learning.ts`; this file reads rows, writes
 * rows, and keeps both scopes inside the authorization the caller already
 * established.
 *
 * Mappings never leave the instance and are never shared between groups. A
 * user-scoped mapping is that person's own habit, readable only by them.
 */

/** Enough for a household's regular merchants without paging the browser. */
const MAPPING_LIMIT = 500;

/**
 * Every mapping that could apply inside this group: the group's own, plus the
 * signed-in user's. Guests have no user scope, only the group's.
 *
 * The whole set is loaded once and handed to the form, so classification stays
 * synchronous while typing and keeps working offline.
 */
export async function loadMappings(
  access: GroupAccess,
  options: { db?: Database; limit?: number } = {},
): Promise<LearnedMerchantMapping[]> {
  const db = options.db ?? getDb();
  const userId = access.actor.kind === "user" ? access.actor.userId : null;

  const scopeFilter = userId
    ? or(
        eq(expenseCategoryMappings.groupId, access.groupId),
        eq(expenseCategoryMappings.userId, userId),
      )
    : eq(expenseCategoryMappings.groupId, access.groupId);

  const rows = await db
    .select({
      scope: expenseCategoryMappings.scope,
      rawMerchant: expenseCategoryMappings.rawMerchant,
      normalizedMerchant: expenseCategoryMappings.normalizedMerchant,
      category: expenseCategoryMappings.category,
      transactionType: expenseCategoryMappings.transactionType,
      correctionCount: expenseCategoryMappings.correctionCount,
      conflictCount: expenseCategoryMappings.conflictCount,
    })
    .from(expenseCategoryMappings)
    .where(scopeFilter)
    .orderBy(desc(expenseCategoryMappings.lastUsedAt))
    .limit(options.limit ?? MAPPING_LIMIT);

  return rows.flatMap(toMapping);
}

/**
 * The group's own mappings, without an actor.
 *
 * The import worker runs minutes after whoever started it closed the page, so
 * there is no user scope to consult and no session to authorize against — the
 * caller has already established that this group is the one being written to.
 * Only group scope is read, which is exactly what a guest's corrections teach.
 */
export async function loadGroupMappings(
  groupId: string,
  options: { db?: Database; limit?: number } = {},
): Promise<LearnedMerchantMapping[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({
      scope: expenseCategoryMappings.scope,
      rawMerchant: expenseCategoryMappings.rawMerchant,
      normalizedMerchant: expenseCategoryMappings.normalizedMerchant,
      category: expenseCategoryMappings.category,
      transactionType: expenseCategoryMappings.transactionType,
      correctionCount: expenseCategoryMappings.correctionCount,
      conflictCount: expenseCategoryMappings.conflictCount,
    })
    .from(expenseCategoryMappings)
    .where(eq(expenseCategoryMappings.groupId, groupId))
    .orderBy(desc(expenseCategoryMappings.lastUsedAt))
    .limit(options.limit ?? MAPPING_LIMIT);

  return rows.flatMap(toMapping);
}

interface MappingRow {
  scope: MappingScope;
  rawMerchant: string;
  normalizedMerchant: string;
  category: string;
  transactionType: string | null;
  correctionCount: number;
  conflictCount: number;
}

/**
 * A stored row as the classifier wants it, or nothing.
 *
 * A category dropped from the vocabulary must not resurrect through an old
 * row, so unknown values are discarded on read rather than trusted.
 */
function toMapping(row: MappingRow): LearnedMerchantMapping[] {
  if (!isExpenseCategory(row.category)) return [];
  return [
    {
      scope: row.scope,
      rawMerchant: row.rawMerchant,
      normalizedMerchant: row.normalizedMerchant,
      category: row.category,
      transactionType: isTransactionType(row.transactionType)
        ? row.transactionType
        : null,
      correctionCount: row.correctionCount,
      conflictCount: row.conflictCount,
    } satisfies LearnedMerchantMapping,
  ];
}

/**
 * Remembers the category someone chose for a merchant.
 *
 * Called with the transaction that writes the expense, so an expense and what
 * it taught the classifier commit together or not at all.
 *
 * Both scopes are written: the group learns the household's habit, the user
 * learns their own. Nothing is recorded for a free-text category (an imported
 * Splitwise label, say) or for a merchant that normalized to nothing.
 */
export async function recordCategoryChoice(
  access: GroupAccess,
  input: {
    merchant: string;
    category: string | null;
    transactionType?: TransactionType | null;
  },
  options: { db?: Database } = {},
): Promise<void> {
  if (!isExpenseCategory(input.category)) return;
  if (input.category === "other") return;

  const { normalizedMerchant } = normalizeMerchant(input.merchant);
  const key = learningKeyFor(normalizedMerchant);
  if (key === "") return;

  const db = options.db ?? getDb();
  const userId = access.actor.kind === "user" ? access.actor.userId : null;

  await upsertMapping(db, {
    scope: "group",
    groupId: access.groupId,
    userId: null,
    key,
    rawMerchant: input.merchant,
    category: input.category,
    transactionType: input.transactionType ?? null,
  });

  if (userId) {
    await upsertMapping(db, {
      scope: "user",
      groupId: null,
      userId,
      key,
      rawMerchant: input.merchant,
      category: input.category,
      transactionType: input.transactionType ?? null,
    });
  }
}

async function upsertMapping(
  db: Database,
  input: {
    scope: MappingScope;
    groupId: string | null;
    userId: string | null;
    key: string;
    rawMerchant: string;
    category: ExpenseCategory;
    transactionType: TransactionType | null;
  },
): Promise<void> {
  const owner =
    input.scope === "group"
      ? eq(expenseCategoryMappings.groupId, input.groupId as string)
      : eq(expenseCategoryMappings.userId, input.userId as string);

  const [existing] = await db
    .select({
      id: expenseCategoryMappings.id,
      category: expenseCategoryMappings.category,
      correctionCount: expenseCategoryMappings.correctionCount,
      conflictCount: expenseCategoryMappings.conflictCount,
    })
    .from(expenseCategoryMappings)
    .where(
      and(
        eq(expenseCategoryMappings.scope, input.scope),
        owner,
        eq(expenseCategoryMappings.normalizedMerchant, input.key),
      ),
    )
    .limit(1);

  const plan = planCorrection({
    scope: input.scope,
    rawMerchant: input.rawMerchant,
    normalizedMerchant: input.key,
    category: input.category,
    existing:
      existing && isExpenseCategory(existing.category)
        ? {
            category: existing.category,
            correctionCount: existing.correctionCount,
            conflictCount: existing.conflictCount,
          }
        : null,
  });

  const now = new Date();

  if (existing) {
    await db
      .update(expenseCategoryMappings)
      .set({
        rawMerchant: plan.rawMerchant,
        category: plan.category,
        transactionType: input.transactionType,
        correctionCount: plan.correctionCount,
        conflictCount: plan.conflictCount,
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(expenseCategoryMappings.id, existing.id));
    return;
  }

  await db
    .insert(expenseCategoryMappings)
    .values({
      scope: input.scope,
      groupId: input.groupId,
      userId: input.userId,
      rawMerchant: plan.rawMerchant,
      normalizedMerchant: plan.normalizedMerchant,
      category: plan.category,
      transactionType: input.transactionType,
      correctionCount: plan.correctionCount,
      conflictCount: plan.conflictCount,
      lastUsedAt: now,
      updatedAt: now,
    })
    // Two people can save the same new merchant at once; the second one is a
    // confirmation, not a failure.
    .onConflictDoUpdate({
      target:
        input.scope === "group"
          ? [
              expenseCategoryMappings.groupId,
              expenseCategoryMappings.normalizedMerchant,
            ]
          : [
              expenseCategoryMappings.userId,
              expenseCategoryMappings.normalizedMerchant,
            ],
      targetWhere: eq(expenseCategoryMappings.scope, input.scope),
      set: {
        rawMerchant: plan.rawMerchant,
        category: plan.category,
        transactionType: input.transactionType,
        lastUsedAt: now,
        updatedAt: now,
      },
    });
}
