import { authorizeGroup } from "@/lib/security/authorization";
import {
  deleteRecurringExpense,
  getRecurringExpense,
  recurringInputSchema,
  setRecurringPaused,
  updateRecurringExpense,
} from "@/modules/recurring/service";
import { RecurrenceError } from "@/modules/recurring/schedule";
import {
  apiActor,
  invalidInput,
  isUuid,
  mobileApiError,
  noStore,
  readJsonBody,
  serializeRecurringDetail,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * One template: read it whole, change it, pause or resume it, or delete it.
 * Expenses it already generated stay through all of these — they are real
 * history, not projections.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/recurring/[templateId]">,
) {
  return trackRoute("/api/groups/[groupId]/recurring/[templateId]", "GET", () =>
    handleGet(request, context),
  );
}

async function handleGet(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/recurring/[templateId]">,
) {
  const { groupId, templateId } = await context.params;
  if (!isUuid(groupId) || !isUuid(templateId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/recurring/[templateId]",
      "GET",
    );
    const access = await authorizeGroup(actor, groupId);
    const template = await getRecurringExpense(access.groupId, templateId);
    if (!template) {
      return noStore({ error: "Not found." }, { status: 404 });
    }
    return noStore({ template: serializeRecurringDetail(template) });
  } catch (error) {
    return mobileApiError(
      error,
      "/api/groups/[groupId]/recurring/[templateId] GET",
      { groupId, templateId },
    );
  }
}

/**
 * Changes the template for the entries still to come: the body `POST` takes,
 * whole, as `updateRecurringExpense` reads it. Entries it already added are
 * not touched.
 */
export async function PUT(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/recurring/[templateId]">,
) {
  return trackRoute("/api/groups/[groupId]/recurring/[templateId]", "PUT", () =>
    handlePut(request, context),
  );
}

async function handlePut(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/recurring/[templateId]">,
) {
  const { groupId, templateId } = await context.params;
  if (!isUuid(groupId) || !isUuid(templateId)) {
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
      "/api/groups/[groupId]/recurring/[templateId]",
      "PUT",
    );
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    // `{id, next, paused}`: the same answer the web form confirms with.
    const updated = await updateRecurringExpense(
      access,
      templateId,
      parsed.data,
    );
    return noStore(updated);
  } catch (error) {
    if (error instanceof RecurrenceError) {
      return noStore({ error: error.message }, { status: 422 });
    }
    return mobileApiError(
      error,
      "/api/groups/[groupId]/recurring/[templateId] PUT",
      { groupId, templateId },
    );
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/recurring/[templateId]">,
) {
  return trackRoute(
    "/api/groups/[groupId]/recurring/[templateId]",
    "PATCH",
    () => handlePatch(request, context),
  );
}

async function handlePatch(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/recurring/[templateId]">,
) {
  const { groupId, templateId } = await context.params;
  if (!isUuid(groupId) || !isUuid(templateId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }
  const body = await readJsonBody(request);
  const raw =
    body !== undefined && typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  if (typeof raw.paused !== "boolean") {
    return noStore({ error: "Send { paused: boolean }." }, { status: 400 });
  }

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/recurring/[templateId]",
      "PATCH",
    );
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    await setRecurringPaused(access, templateId, raw.paused);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(
      error,
      "/api/groups/[groupId]/recurring/[templateId] PATCH",
      { groupId, templateId },
    );
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/recurring/[templateId]">,
) {
  return trackRoute(
    "/api/groups/[groupId]/recurring/[templateId]",
    "DELETE",
    () => handleDelete(request, context),
  );
}

async function handleDelete(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/recurring/[templateId]">,
) {
  const { groupId, templateId } = await context.params;
  if (!isUuid(groupId) || !isUuid(templateId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/recurring/[templateId]",
      "DELETE",
    );
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    await deleteRecurringExpense(access, templateId);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(
      error,
      "/api/groups/[groupId]/recurring/[templateId] DELETE",
      { groupId, templateId },
    );
  }
}
