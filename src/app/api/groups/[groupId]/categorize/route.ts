import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { classifyTransactionSync } from "@/modules/categorization";
import { loadMappings } from "@/modules/categorization/service";
import { isUuid, mobileApiError, noStore } from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

const ROUTE = "/api/groups/[groupId]/categorize";

/**
 * What a description is about, decided here rather than on the phone.
 *
 * The browser runs this same classifier locally, and for good reason: it
 * answers between keystrokes and keeps answering with the network gone. A
 * phone cannot have that without carrying the rules, and the rules are three
 * and a half thousand lines of merchants and phrases that grow every week.
 * Copying them into a second language is how the two ends start disagreeing
 * about what `Migros` is — the same reason the category vocabulary is read
 * from the server's message catalogues instead of being transcribed.
 *
 * So the phone asks, debounced, and does without an answer when it cannot
 * reach us. Only the deterministic pass runs: the semantic one needs an
 * embedder that lives in a worker, and the browser does not wait for it
 * either — what the reader sees first is this.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/categorize">,
) {
  return trackRoute(ROUTE, "POST", () => handlePost(request, context));
}

async function handlePost(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/categorize">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);

    const body = (await request.json().catch(() => null)) as {
      description?: unknown;
      note?: unknown;
      recurring?: unknown;
    } | null;
    const description =
      typeof body?.description === "string" ? body.description : "";
    const note = typeof body?.note === "string" ? body.note : undefined;
    const recurring = body?.recurring === true;

    // Nothing to go on is not an error: the field is simply still empty, and
    // the phone asks again on the next keystroke.
    if (description.trim() === "" && (note ?? "").trim() === "") {
      return noStore({ classification: null });
    }

    const mappings = await loadMappings(access);
    const result = classifyTransactionSync(
      { description, note, recurring },
      { mappings },
    );

    return noStore({
      classification: {
        transactionType: result.transactionType,
        category: result.category ?? null,
        subcategory: result.subcategory ?? null,
        confidence: result.confidence,
      },
    });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} POST`, { groupId });
  }
}
