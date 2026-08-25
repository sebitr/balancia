import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { loadMemberStats } from "@/modules/groups/member-stats-service";
import { listParticipants } from "@/modules/groups/service";
import {
  isUuid,
  mobileApiError,
  noStore,
  serializeMemberStats,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * One member's statistics, as their row on the balances screen leads to.
 *
 * Removed people are included, exactly as the web page includes them: they
 * keep the entries they were on, and a balance row that still names them has
 * to lead somewhere. A participant of another group is a 404, like every
 * other id this API cannot confirm.
 */

const ROUTE = "/api/groups/[groupId]/participants/[participantId]/stats";
type Context =
  RouteContext<"/api/groups/[groupId]/participants/[participantId]/stats">;

export async function GET(request: Request, context: Context) {
  return trackRoute(ROUTE, "GET", () => handleGet(context));
}

async function handleGet(context: Context) {
  const { groupId, participantId } = await context.params;
  if (!isUuid(groupId) || !isUuid(participantId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    const people = await listParticipants(access.groupId, {
      includeRemoved: true,
    });
    if (!people.some((person) => person.id === participantId)) {
      return noStore({ error: "Not found." }, { status: 404 });
    }
    const stats = await loadMemberStats(access, participantId);
    return noStore({ stats: serializeMemberStats(stats) });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} GET`, { groupId, participantId });
  }
}
