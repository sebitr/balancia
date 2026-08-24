import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { restoreRecurringExpense } from "@/modules/recurring/service";
import { isUuid, mobileApiError, noStore } from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Undo for a removal, same as the web's toast offers. The template starts
 * looking for its next date again on the worker's next tick.
 */

const ROUTE = "/api/groups/[groupId]/recurring/[templateId]/restore";
type Context =
  RouteContext<"/api/groups/[groupId]/recurring/[templateId]/restore">;

export async function POST(request: Request, context: Context) {
  return trackRoute(ROUTE, "POST", () => handlePost(context));
}

async function handlePost(context: Context) {
  const { groupId, templateId } = await context.params;
  if (!isUuid(groupId) || !isUuid(templateId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    await restoreRecurringExpense(access, templateId);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} POST`, { groupId, templateId });
  }
}
