import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { loadSettleUp } from "@/modules/settlements/settle-up";
import { buildPayoutHints } from "@/modules/payouts/hints";
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
    /*
     * How to pay each of the reader's own debts, for the same rows the web
     * screen puts them on. Read after the transfers and from them: a
     * recipient's details are reachable only by appearing in a debt the
     * balances say this reader owes.
     */
    const hints = await buildPayoutHints(
      access.groupId,
      access.group.name,
      view,
    );
    return noStore({ settleUp: serializeSettleUp(view, hints) });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} GET`, { groupId });
  }
}
