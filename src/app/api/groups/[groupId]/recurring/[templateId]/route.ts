import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import {
  deleteRecurringExpense,
  setRecurringPaused,
} from "@/modules/recurring/service";
import {
  isUuid,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * One template: pause or resume it, or delete it. Expenses it already
 * generated stay — they are real history, not projections.
 */
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
    const actor = await getCurrentActor();
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
    () => handleDelete(context),
  );
}

async function handleDelete(
  context: RouteContext<"/api/groups/[groupId]/recurring/[templateId]">,
) {
  const { groupId, templateId } = await context.params;
  if (!isUuid(groupId) || !isUuid(templateId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
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
