import { authorizeGroup } from "@/lib/security/authorization";
import {
  listRecurringExpenses,
  recurringInputSchema,
  setUpRecurringExpense,
} from "@/modules/recurring/service";
import { RecurrenceError } from "@/modules/recurring/schedule";
import {
  apiActor,
  invalidInput,
  isUuid,
  mobileApiError,
  noStore,
  readJsonBody,
  serializeRecurring,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Recurring templates: the list, and creating one. The template holds the
 * same fields as an expense plus its schedule. Creating one adds, in the same
 * request, the entries whose dates have already come, exactly as the web form
 * does — see `setUpRecurringExpense`; the worker makes every one after that.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/recurring">,
) {
  return trackRoute("/api/groups/[groupId]/recurring", "GET", () =>
    handleGet(request, context),
  );
}

async function handleGet(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/recurring">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/recurring",
      "GET",
    );
    const access = await authorizeGroup(actor, groupId);
    const templates = await listRecurringExpenses(access.groupId);
    return noStore({ templates: templates.map(serializeRecurring) });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/recurring GET", {
      groupId,
    });
  }
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/recurring">,
) {
  return trackRoute("/api/groups/[groupId]/recurring", "POST", () =>
    handlePost(request, context),
  );
}

async function handlePost(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/recurring">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }
  const body = await readJsonBody(request);
  if (body === undefined) {
    return noStore({ error: "Send a JSON body." }, { status: 400 });
  }

  const parsed = recurringInputSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/recurring",
      "POST",
    );
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    // `{id, added, addedFrom, next}`: the same answer the web form's
    // confirmation is written from.
    const setUp = await setUpRecurringExpense(access, parsed.data);
    return noStore(setUp, { status: 201 });
  } catch (error) {
    if (error instanceof RecurrenceError) {
      return noStore({ error: error.message }, { status: 422 });
    }
    return mobileApiError(error, "/api/groups/[groupId]/recurring POST", {
      groupId,
    });
  }
}
