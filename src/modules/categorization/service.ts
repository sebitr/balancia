import "server-only";
import {
  and,
  count,
  desc,
  eq,
  isNotNull,
  isNull,
  max,
  ne,
  or,
} from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { expenseCategoryMappings, expenses } from "@/lib/db/schema";
import type { GroupAccess } from "@/lib/security/authorization";
import { learningKeyFor, planCorrection } from "./learning";
import { normalizeMerchant } from "./normalize";
import {
  isExpenseCategory,
  isTransactionType,
  isValidSubcategory,
  normalizeLegacyCategory,
  normalizeLegacyPair,
  type ExpenseCategory,
  type ExpenseSubcategory,
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
      subcategory: expenseCategoryMappings.subcategory,
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
      subcategory: expenseCategoryMappings.subcategory,
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

/**
 * How many rows the frequency query returns before filtering.
 *
 * The picker shows at most three, but this list is filtered afterwards — codes
 * retired from the vocabulary and the imported free-text labels that share the
 * column both drop out on read — so it asks for enough that three survive.
 */
const FREQUENT_SCAN = 8;

/**
 * What this group actually files things as, most used first.
 *
 * The category picker leads with a handful of chips rather than the whole
 * vocabulary, and until there is a description to classify, the only honest
 * basis for choosing them is what this household has picked before. A fixed
 * list would be a guess about a group we can already measure.
 *
 * Ordered by use and then by recency, which are the same thing for a young
 * group and diverge usefully for an old one: the tie is broken towards what
 * was chosen most recently rather than towards whatever happens to sort first.
 *
 * `other` is excluded on purpose. It is the escape hatch — a group that files
 * a lot under it has told us nothing about what to offer, and putting it in
 * the shortlist would make the least informative answer the easiest to pick.
 * Free-text categories from an import are excluded by the same read-time check
 * the mappings use: they are labels, not codes, and nothing can be filed under
 * them deliberately.
 */
export async function loadFrequentCategories(
  access: GroupAccess,
  options: { db?: Database; limit?: number } = {},
): Promise<ExpenseCategory[]> {
  const db = options.db ?? getDb();
  const uses = count();
  const lastUsed = max(expenses.createdAt);

  const rows = await db
    .select({ category: expenses.category, uses, lastUsed })
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, access.groupId),
        isNull(expenses.deletedAt),
        isNotNull(expenses.category),
        ne(expenses.category, ""),
        ne(expenses.category, "other"),
      ),
    )
    .groupBy(expenses.category)
    .orderBy(desc(uses), desc(lastUsed))
    .limit(options.limit ?? FREQUENT_SCAN);

  /**
   * Retired codes are folded into their replacement rather than skipped, so a
   * group whose history is mostly `housing` and `utilities` still sees `home`
   * offered first. That folding can produce the same code twice — both of
   * those become `home` — and the order is already "most used first", so the
   * first sighting is the one that keeps its place.
   */
  const seen = new Set<ExpenseCategory>();
  const frequent: ExpenseCategory[] = [];
  for (const row of rows) {
    const category = normalizeLegacyCategory(row.category);
    if (category === null || category === "other" || seen.has(category)) {
      continue;
    }
    seen.add(category);
    frequent.push(category);
  }
  return frequent;
}

interface MappingRow {
  scope: MappingScope;
  rawMerchant: string;
  normalizedMerchant: string;
  category: string;
  subcategory: string | null;
  transactionType: string | null;
  correctionCount: number;
  conflictCount: number;
}

/**
 * A stored row as the classifier wants it, or nothing.
 *
 * A category dropped from the vocabulary must not resurrect through an old
 * row, so unknown values are discarded on read rather than trusted — but a
 * *retired* one is translated instead of dropped. The migration rewrites these
 * rows, and this is what covers the instance that has not restarted its worker
 * yet, or a row written by a replica still running the previous release.
 *
 * The *pair* is translated, not just the category: someone who taught this
 * group that `CSS ASSURANCE` means `health` / `health_insurance` taught it
 * something that is now `insurance` / `health`, and the whole answer moves.
 * A subcategory that does not belong to the category it ends on is dropped —
 * it was learned under a code that no longer exists, so nothing guarantees it
 * still fits.
 */
function toMapping(row: MappingRow): LearnedMerchantMapping[] {
  const { category, subcategory } = normalizeLegacyPair({
    category: row.category,
    subcategory: row.subcategory,
  });
  if (category === null) return [];
  return [
    {
      scope: row.scope,
      rawMerchant: row.rawMerchant,
      normalizedMerchant: row.normalizedMerchant,
      category,
      subcategory,
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
    subcategory?: string | null;
    transactionType?: TransactionType | null;
  },
  options: { db?: Database } = {},
): Promise<void> {
  if (!isExpenseCategory(input.category)) return;
  if (input.category === "other") return;

  /**
   * The subcategory rides along only when it belongs to the category being
   * taught. A mismatched pair is dropped rather than refused: the mapping
   * "Coop means groceries" is worth keeping even if the child that came with
   * it was stale, and this is a side effect of saving an expense — it must
   * never be the reason one fails.
   */
  const subcategory = isValidSubcategory(input.category, input.subcategory)
    ? ((input.subcategory || null) as ExpenseSubcategory | null)
    : null;

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
    subcategory,
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
      subcategory,
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
    subcategory: ExpenseSubcategory | null;
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
        // Tied to the category actually stored: when `planCorrection` keeps
        // the existing one, the incoming child would be an orphan under it.
        subcategory:
          plan.category === input.category ? input.subcategory : null,
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
      subcategory: plan.category === input.category ? input.subcategory : null,
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
        subcategory:
          plan.category === input.category ? input.subcategory : null,
        transactionType: input.transactionType,
        lastUsedAt: now,
        updatedAt: now,
      },
    });
}
