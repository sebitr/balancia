import { authorizeGroup } from "@/lib/security/authorization";
import {
  deleteExpense,
  getExpense,
  updateExpense,
} from "@/modules/expenses/service";
import { expenseInputSchema } from "@/modules/expenses/schemas";
import {
  apiActor,
  ifMatchVersion,
  invalidInput,
  isUuid,
  mobileApiError,
  noStore,
  readJsonBody,
  serializeExpense,
  serializeSplitInput,
  versionTag,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * One expense: read back with its raw split inputs (so the edit form reopens
 * at what was typed), replaced wholesale by PATCH, or soft-deleted. PATCH
 * takes the full `expenseInputSchema` rather than a partial — that is what
 * `updateExpense` means, and partial merges are where splits go stale.
 *
 * GET answers with the entry's version as an `ETag`; PATCH honours it as
 * `If-Match` and answers 409 when somebody else changed the entry in between.
 * The header is optional — see `ifMatchVersion`.
 */

const ROUTE = "/api/groups/[groupId]/expenses/[expenseId]";
type Context = RouteContext<"/api/groups/[groupId]/expenses/[expenseId]">;

export async function GET(request: Request, context: Context) {
  return trackRoute(ROUTE, "GET", () => handleGet(request, context));
}

async function handleGet(request: Request, context: Context) {
  const { groupId, expenseId } = await context.params;
  if (!isUuid(groupId) || !isUuid(expenseId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/expenses/[expenseId]",
      "GET",
    );
    const access = await authorizeGroup(actor, groupId);
    const expense = await getExpense(access.groupId, expenseId);
    if (!expense) {
      return noStore({ error: "Not found." }, { status: 404 });
    }
    return noStore(
      {
        expense: {
          ...serializeExpense(expense),
          splitInput: serializeSplitInput(expense.splitInput),
          version: expense.version,
        },
      },
      { headers: { ETag: versionTag(expense.version) } },
    );
  } catch (error) {
    return mobileApiError(error, `${ROUTE} GET`, { groupId, expenseId });
  }
}

export async function PATCH(request: Request, context: Context) {
  return trackRoute(ROUTE, "PATCH", () => handlePatch(request, context));
}

async function handlePatch(request: Request, context: Context) {
  const { groupId, expenseId } = await context.params;
  if (!isUuid(groupId) || !isUuid(expenseId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }
  const body = await readJsonBody(request);
  if (body === undefined) {
    return noStore({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = expenseInputSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/expenses/[expenseId]",
      "PATCH",
    );
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    const version = await updateExpense(access, expenseId, parsed.data, {
      expectedVersion: ifMatchVersion(request),
    });
    // The new version comes back too, so a client can edit again without
    // reading the entry first.
    return noStore(
      { ok: true, version },
      { headers: { ETag: versionTag(version) } },
    );
  } catch (error) {
    return mobileApiError(error, `${ROUTE} PATCH`, { groupId, expenseId });
  }
}

export async function DELETE(request: Request, context: Context) {
  return trackRoute(ROUTE, "DELETE", () => handleDelete(request, context));
}

async function handleDelete(request: Request, context: Context) {
  const { groupId, expenseId } = await context.params;
  if (!isUuid(groupId) || !isUuid(expenseId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/expenses/[expenseId]",
      "DELETE",
    );
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    await deleteExpense(access, expenseId);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} DELETE`, { groupId, expenseId });
  }
}
