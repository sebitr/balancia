import { z } from "zod";
import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import {
  createSettlement,
  listSettlements,
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
 * A group's repayments, and the write that records one. The POST body is
 * `settlementInputSchema` verbatim, shared with the web form's action.
 */

const limitSchema = z.coerce.number().int().min(1).max(500).catch(100);

export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/settlements">,
) {
  return trackRoute("/api/groups/[groupId]/settlements", "GET", () =>
    handleGet(request, context),
  );
}

async function handleGet(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/settlements">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }
  const limit = limitSchema.parse(
    new URL(request.url).searchParams.get("limit"),
  );

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    const settlements = await listSettlements(access.groupId, { limit });
    return noStore({
      settlements: settlements.map(serializeSettlement),
      limit,
    });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/settlements GET", {
      groupId,
    });
  }
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/settlements">,
) {
  return trackRoute("/api/groups/[groupId]/settlements", "POST", () =>
    handlePost(request, context),
  );
}

async function handlePost(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/settlements">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
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
    const settlementId = await createSettlement(access, parsed.data);
    return noStore({ settlementId }, { status: 201 });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/settlements POST", {
      groupId,
    });
  }
}
