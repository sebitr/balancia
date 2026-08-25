import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { loadSettleUp } from "@/modules/settlements/settle-up";
import {
  isUuid,
  mobileApiError,
  noStore,
  serializeSettleUp,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * What it would take to clear the group.
 *
 * The overview answers "where do I stand"; this answers "what do I do about
 * it". Reading it writes nothing — the transfers it lists are recorded, if
 * they ever are, through the settlements route.
 */

const ROUTE = "/api/groups/[groupId]/settle-up";
type Context = RouteContext<"/api/groups/[groupId]/settle-up">;

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
    const view = await loadSettleUp(access);
    return noStore({ settleUp: serializeSettleUp(view) });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} GET`, { groupId });
  }
}
