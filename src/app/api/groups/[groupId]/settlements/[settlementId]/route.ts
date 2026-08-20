import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import {
  deleteSettlement,
  getSettlement,
  updateSettlement,
} from "@/modules/settlements/service";
import { settlementInputSchema } from "@/modules/expenses/schemas";
import {
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
  return trackRoute(ROUTE, "GET", () => handleGet(context));
}

async function handleGet(context: Context) {
  const { groupId, settlementId } = await context.params;
  if (!isUuid(groupId) || !isUuid(settlementId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
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
    const actor = await getCurrentActor();
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
  return trackRoute(ROUTE, "DELETE", () => handleDelete(context));
}

async function handleDelete(context: Context) {
  const { groupId, settlementId } = await context.params;
  if (!isUuid(groupId) || !isUuid(settlementId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    await deleteSettlement(access, settlementId);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} DELETE`, { groupId, settlementId });
  }
}
