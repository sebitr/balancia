import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getCurrentUser } from "./actor";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  type UserActor,
} from "./authorization";

/**
 * The instance administrator.
 *
 * Balancia had no such role before telemetry: every permission it had was
 * about one group's money, and `group_members.role` answered all of them. A
 * decision that applies to the whole installation — "does this instance send
 * anonymous statistics" — belongs to whoever runs the installation, and
 * nobody else, so there had to be a way to say who that is.
 *
 * The rule is deliberately boring: the first account created on an instance is
 * its administrator, because on a self-hosted deployment that account is the
 * operator. There is no way to ask for the flag, no invitation that grants it
 * and no UI that sets it — a second administrator is one `UPDATE users SET
 * is_admin = true WHERE …`, run by someone who already has the database.
 *
 * Group ownership grants nothing here. The owner of a group is not the owner
 * of the server, and on a shared instance those are usually different people.
 */

/** Whether this account is an instance administrator. */
export async function isInstanceAdmin(userId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isAdmin, true)))
    .limit(1);
  return row !== undefined;
}

/** The signed-in administrator, or null — for deciding what to render. */
export async function getCurrentAdmin(): Promise<UserActor | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return (await isInstanceAdmin(user.userId)) ? user : null;
}

/**
 * Resolves the caller and refuses anyone who is not an administrator.
 *
 * Both errors are already understood by the Server Action funnel
 * (`src/lib/actions.ts`), so an administration action that is called by a
 * participant fails with the same safe, translated message as any other
 * authorization failure — and without saying whether the setting exists.
 */
export async function requireInstanceAdmin(): Promise<UserActor> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthenticationRequiredError();
  }
  if (!(await isInstanceAdmin(user.userId))) {
    throw new AuthorizationError(
      "Only an instance administrator can change this.",
      "adminRequired",
    );
  }
  return user;
}
