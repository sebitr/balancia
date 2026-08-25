import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/security/actor";
import { trackRoute } from "@/lib/metrics/http";
import { deleteSubscriptionById } from "@/modules/notifications/subscriptions";

/**
 * Forgetting a device from the list on the notifications screen.
 *
 * The sibling `DELETE /api/push/subscriptions` takes an endpoint, which is how
 * a browser unsubscribes *itself* — it is the only party that knows its own
 * endpoint. This one takes the row id, which is what the device list has,
 * because an endpoint is a capability to send to somebody's phone and never
 * leaves the server towards a page.
 *
 * The id alone authorizes nothing: the delete is scoped to the caller in the
 * same statement, so an id belonging to another account matches no row and
 * answers exactly as a made-up one does.
 */
export async function DELETE(
  request: Request,
  context: RouteContext<"/api/push/subscriptions/[id]">,
) {
  return trackRoute("/api/push/subscriptions/[id]", "DELETE", () =>
    handleDelete(request, context),
  );
}

async function handleDelete(
  _request: Request,
  context: RouteContext<"/api/push/subscriptions/[id]">,
) {
  const t = await getTranslations("serverErrors");

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: t("authRequired") }, { status: 401 });
  }

  const { id } = await context.params;
  const removed = await deleteSubscriptionById(user.userId, id);
  if (!removed) {
    return NextResponse.json({ error: t("notFound") }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
