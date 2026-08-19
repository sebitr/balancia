import { z } from "zod";
import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { createExpense, listExpenses } from "@/modules/expenses/service";
import { expenseInputSchema } from "@/modules/expenses/schemas";
import {
  invalidInput,
  isUuid,
  mobileApiError,
  noStore,
  readJsonBody,
  serializeExpense,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * A group's expenses, newest first, and the write that adds one.
 *
 * The POST body is `expenseInputSchema` verbatim — the same contract the web
 * form submits through its Server Action, amounts as minor-unit strings and
 * all — so the two clients cannot drift apart on what an expense is.
 */

const limitSchema = z.coerce.number().int().min(1).max(200).catch(50);
const offsetSchema = z.coerce.number().int().min(0).catch(0);

export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/expenses">,
) {
  return trackRoute("/api/groups/[groupId]/expenses", "GET", () =>
    handleGet(request, context),
  );
}

async function handleGet(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/expenses">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }
  const searchParams = new URL(request.url).searchParams;
  const limit = limitSchema.parse(searchParams.get("limit"));
  const offset = offsetSchema.parse(searchParams.get("offset"));

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    const expenses = await listExpenses(access.groupId, { limit, offset });
    return noStore({
      expenses: expenses.map(serializeExpense),
      limit,
      offset,
    });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/expenses GET", {
      groupId,
    });
  }
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/expenses">,
) {
  return trackRoute("/api/groups/[groupId]/expenses", "POST", () =>
    handlePost(request, context),
  );
}

async function handlePost(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/expenses">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
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
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    const expenseId = await createExpense(access, parsed.data);
    return noStore({ expenseId }, { status: 201 });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/expenses POST", {
      groupId,
    });
  }
}
