import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import {
  loadFrequentCategories,
  loadMappings,
} from "@/modules/categorization/service";
import { isUuid, mobileApiError, noStore } from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * What the category picker needs to suggest well: this group's frequently
 * used categories, and the learned merchant→category mappings (the group's
 * own plus the reader's). Classification itself stays on the client, so it
 * keeps working while typing.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/categories">,
) {
  return trackRoute("/api/groups/[groupId]/categories", "GET", () =>
    handleGet(context),
  );
}

async function handleGet(
  context: RouteContext<"/api/groups/[groupId]/categories">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    const [frequent, mappings] = await Promise.all([
      loadFrequentCategories(access),
      loadMappings(access),
    ]);
    return noStore({ frequent, mappings });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/categories GET", {
      groupId,
    });
  }
}
