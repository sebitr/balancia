import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { loadGroupOverview } from "@/modules/groups/overview";
import { listParticipants } from "@/modules/groups/service";
import {
  isUuid,
  mobileApiError,
  noStore,
  serializeAccess,
  serializeGroupOverview,
  serializeParticipant,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * One group, as its screen opens: who the reader is in it, everyone's
 * balances and the simplified who-pays-whom, and the people to offer in
 * pickers. Expenses and settlements page separately under their own routes.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]">,
) {
  return trackRoute("/api/groups/[groupId]", "GET", () => handleGet(context));
}

async function handleGet(context: RouteContext<"/api/groups/[groupId]">) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);

    const [overview, participants] = await Promise.all([
      loadGroupOverview(access),
      listParticipants(access.groupId),
    ]);

    return noStore({
      ...serializeAccess(access),
      participants: participants.map(serializeParticipant),
      overview: serializeGroupOverview(overview),
    });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId] GET", { groupId });
  }
}
