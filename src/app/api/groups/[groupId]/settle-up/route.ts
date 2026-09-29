import { authorizeGroup } from "@/lib/security/authorization";
import { loadSettleUp } from "@/modules/settlements/settle-up";
import { buildPayoutHints } from "@/modules/payouts/hints";
import {
  apiActor,
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
  return trackRoute(ROUTE, "GET", () => handleGet(request, context));
}

async function handleGet(request: Request, context: Context) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/settle-up",
      "GET",
    );
    const access = await authorizeGroup(actor, groupId);
    const view = await loadSettleUp(access);
    /*
     * How to pay each of the reader's own debts, for the same rows the web
     * screen puts them on. Read after the transfers and from them: a
     * recipient's details are reachable only by appearing in a debt the
     * balances say this reader owes.
     *
     * Never to an API key, at any scope. A key is pasted into other people's
     * software and forwarded with it, and the debt that unlocks a hint is one
     * the key's own holder can write — an expense "paid by them, split on me"
     * is a single request. Nothing a script does needs somebody's IBAN, so a
     * key reads every transfer and an empty list where the hints would be:
     * the same shape, with nothing in it to leak.
     */
    const readsPayouts = !(
      access.actor.kind === "user" && access.actor.viaApiToken
    );
    const hints = readsPayouts
      ? await buildPayoutHints(access.groupId, access.group.name, view)
      : [];
    return noStore({ settleUp: serializeSettleUp(view, hints) });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} GET`, { groupId });
  }
}
