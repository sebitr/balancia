import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { loadGroupStats } from "@/modules/groups/group-stats-service";
import {
  isUuid,
  mobileApiError,
  noStore,
  serializeGroupStats,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The group's statistics screen, in one read.
 *
 * Not `requireActive`: an archived group is the one a reader is most likely to
 * be looking back over, and nothing here writes.
 */

const ROUTE = "/api/groups/[groupId]/stats";
type Context = RouteContext<"/api/groups/[groupId]/stats">;

export async function GET(request: Request, context: Context) {
  return trackRoute(ROUTE, "GET", () => handleGet(context));
}

async function handleGet(context: Context) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    const stats = await loadGroupStats(access);
    return noStore({ stats: serializeGroupStats(stats) });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} GET`, { groupId });
  }
}
