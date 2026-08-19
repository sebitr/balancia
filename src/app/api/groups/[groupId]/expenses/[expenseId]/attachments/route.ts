import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { listAttachmentsForExpense } from "@/modules/attachments/service";
import { isUuid, mobileApiError, noStore } from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The receipts on one expense, for the detail screen. Each row's bytes come
 * from the existing per-attachment download route.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/expenses/[expenseId]/attachments">,
) {
  return trackRoute(
    "/api/groups/[groupId]/expenses/[expenseId]/attachments",
    "GET",
    () => handleGet(context),
  );
}

async function handleGet(
  context: RouteContext<"/api/groups/[groupId]/expenses/[expenseId]/attachments">,
) {
  const { groupId, expenseId } = await context.params;
  if (!isUuid(groupId) || !isUuid(expenseId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    const attachments = await listAttachmentsForExpense(
      access.groupId,
      expenseId,
    );
    return noStore({
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        byteSize: attachment.byteSize,
        createdAt: attachment.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return mobileApiError(
      error,
      "/api/groups/[groupId]/expenses/[expenseId]/attachments GET",
      { groupId, expenseId },
    );
  }
}
