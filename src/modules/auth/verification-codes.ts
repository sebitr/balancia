import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { verificationTokens } from "@/lib/db/schema";
import { isWellFormedCode } from "./code-format";
import { codeHash, codesMatch, generateCode } from "./codes";

/**
 * Issuing and spending the six-digit codes.
 *
 * They live in `verification_tokens` alongside the link tokens because
 * everything the table already enforces is what a code needs too — one live
 * token per purpose, an expiry, a consumption stamp that makes it single-use.
 * What differs is how one is found: never by its own hash, always inside the
 * account it was issued for. `codes.ts` explains why.
 *
 * Ten minutes is the window. Long enough for mail to be delivered and read on
 * a second device, short enough that a code left in an inbox is not a standing
 * key to the account.
 */

const CODE_TTL_MS = 10 * 60 * 1000;

export type CodePurpose = "email_verification_code" | "sign_in_code";

/**
 * Mints a code for one account and returns it to be mailed.
 *
 * Issuing invalidates whatever was live before, so asking for a second code
 * because the first has not arrived cannot leave two working codes behind.
 */
export async function issueCode(
  userId: string,
  purpose: CodePurpose,
  options: { db?: Database } = {},
): Promise<string> {
  const db = options.db ?? getDb();
  const code = generateCode();

  await db
    .update(verificationTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(verificationTokens.userId, userId),
        eq(verificationTokens.purpose, purpose),
        isNull(verificationTokens.consumedAt),
      ),
    );

  await db.insert(verificationTokens).values({
    userId,
    purpose,
    tokenHash: codeHash(userId, code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  return code;
}

/**
 * Checks a code against one account's live token and spends it.
 *
 * Read first, compare in constant time, then consume by row id conditional on
 * it still being unconsumed — so the comparison leaks nothing through timing
 * and two submissions of the same code cannot both succeed.
 */
export async function consumeCode(
  userId: string,
  purpose: CodePurpose,
  code: string,
  options: { db?: Database } = {},
): Promise<boolean> {
  if (!isWellFormedCode(code)) return false;
  const db = options.db ?? getDb();

  const [live] = await db
    .select({ id: verificationTokens.id, hash: verificationTokens.tokenHash })
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.userId, userId),
        eq(verificationTokens.purpose, purpose),
        isNull(verificationTokens.consumedAt),
        gt(verificationTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!live || !codesMatch(live.hash, codeHash(userId, code))) return false;

  const [consumed] = await db
    .update(verificationTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(verificationTokens.id, live.id),
        isNull(verificationTokens.consumedAt),
      ),
    )
    .returning({ id: verificationTokens.id });

  return Boolean(consumed);
}

export { CODE_TTL_MS };
