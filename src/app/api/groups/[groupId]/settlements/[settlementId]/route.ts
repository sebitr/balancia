import { authorizeGroup } from "@/lib/security/authorization";
import {
  deleteSettlement,
  getSettlement,
  updateSettlement,
} from "@/modules/settlements/service";
import { settlementInputSchema } from "@/modules/expenses/schemas";
import {
  apiActor,
  invalidInput,
  isUuid,
  mobileApiError,
  noStore,
  readJsonBody,
  serializeSettlement,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * One repayment: read back with its payment method (which the list omits on
 * purpose — see `getSettlement`), replaced wholesale by PATCH, soft-deleted
 * by DELETE.
 */

const ROUTE = "/api/groups/[groupId]/settlements/[settlementId]";
type Context = RouteContext<"/api/groups/[groupId]/settlements/[settlementId]">;

export async function GET(request: Request, context: Context) {
  return trackRoute(ROUTE, "GET", () => handleGet(request, context));
}

async function handleGet(request: Request, context: Context) {
  const { groupId, settlementId } = await context.params;
  if (!isUuid(groupId) || !isUuid(settlementId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/settlements/[settlementId]",
      "GET",
    );
    const access = await authorizeGroup(actor, groupId);
    const settlement = await getSettlement(access.groupId, settlementId);
    if (!settlement) {
      return noStore({ error: "Not found." }, { status: 404 });
    }
    return noStore({
      settlement: {
        ...serializeSettlement(settlement),
        paymentMethod: settlement.paymentMethod,
      },
    });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} GET`, { groupId, settlementId });
  }
}

export async function PATCH(request: Request, context: Context) {
  return trackRoute(ROUTE, "PATCH", () => handlePatch(request, context));
}

async function handlePatch(request: Request, context: Context) {
  const { groupId, settlementId } = await context.params;
  if (!isUuid(groupId) || !isUuid(settlementId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }
  const body = await readJsonBody(request);
  if (body === undefined) {
    return noStore({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = settlementInputSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/settlements/[settlementId]",
      "PATCH",
    );
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    await updateSettlement(access, settlementId, parsed.data);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} PATCH`, { groupId, settlementId });
  }
}

export async function DELETE(request: Request, context: Context) {
  return trackRoute(ROUTE, "DELETE", () => handleDelete(request, context));
}

async function handleDelete(request: Request, context: Context) {
  const { groupId, settlementId } = await context.params;
  if (!isUuid(groupId) || !isUuid(settlementId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/settlements/[settlementId]",
      "DELETE",
    );
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    await deleteSettlement(access, settlementId);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} DELETE`, { groupId, settlementId });
  }
}
