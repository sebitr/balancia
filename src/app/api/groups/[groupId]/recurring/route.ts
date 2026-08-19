import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import {
  createRecurringExpense,
  listRecurringExpenses,
  recurringInputSchema,
} from "@/modules/recurring/service";
import { RecurrenceError } from "@/modules/recurring/schedule";
import {
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
 * same fields as an expense plus its schedule; the worker turns it into real
 * expenses on time, never this route.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/recurring">,
) {
  return trackRoute("/api/groups/[groupId]/recurring", "GET", () =>
    handleGet(context),
  );
}

async function handleGet(
  context: RouteContext<"/api/groups/[groupId]/recurring">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
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
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    const id = await createRecurringExpense(access, parsed.data);
    return noStore({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof RecurrenceError) {
      return noStore({ error: error.message }, { status: 422 });
    }
    return mobileApiError(error, "/api/groups/[groupId]/recurring POST", {
      groupId,
    });
  }
}
