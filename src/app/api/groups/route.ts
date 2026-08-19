import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getCurrentActor } from "@/lib/security/actor";
import { loadHomeOverview } from "@/modules/balances/overview";
import {
  mobileApiError,
  noStore,
  serializeHomeOverview,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The home screen's read: every group the account belongs to, bucketed by
 * whether it needs the reader, with the same net position the web header
 * shows. Guests are pinned to one group and have no home; the whoami route
 * tells them which group is theirs, and they read it directly.
 */
export async function GET() {
  return trackRoute("/api/groups", "GET", handleGet);
}

async function handleGet() {
  try {
    const actor = await getCurrentActor();
    if (!actor) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }
    if (actor.kind !== "user") {
      return noStore(
        { error: "Sign in with an account to list groups." },
        { status: 403 },
      );
    }

    const db = getDb();
    const [preferences] = await db
      .select({ preferredCurrency: users.preferredCurrency })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1);

    const overview = await loadHomeOverview(actor.userId, {
      preferredCurrency: preferences?.preferredCurrency ?? null,
    });
    return noStore(serializeHomeOverview(overview));
  } catch (error) {
    return mobileApiError(error, "/api/groups GET");
  }
}
