import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { restoreExpense } from "@/modules/expenses/service";
import { isUuid, mobileApiError, noStore } from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Undo for a deletion, same as the web's toast offers.
 *
 * Deletion is soft, so this is a real restoration and not a re-creation: the
 * expense comes back under its own id, with the payers, shares and
 * attachments it always had. An expense that was never deleted answers 404
 * rather than pretending to have restored something.
 */

const ROUTE = "/api/groups/[groupId]/expenses/[expenseId]/restore";
type Context =
  RouteContext<"/api/groups/[groupId]/expenses/[expenseId]/restore">;

export async function POST(request: Request, context: Context) {
  return trackRoute(ROUTE, "POST", () => handlePost(context));
}

async function handlePost(context: Context) {
  const { groupId, expenseId } = await context.params;
  if (!isUuid(groupId) || !isUuid(expenseId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    await restoreExpense(access, expenseId);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} POST`, { groupId, expenseId });
  }
}
