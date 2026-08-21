import { NextResponse } from "next/server";
import { decodeCursor } from "@/lib/db/keyset";
import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { loadTransactionPage } from "@/modules/expenses/transactions";
import { logger } from "@/lib/logger";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The next page of a group's transactions.
 *
 * A route handler rather than a Server Action because this is a read. An
 * action would return the re-rendered page alongside its result — the whole
 * screen, the category spread and the first page of rows built again — for
 * every forty rows the reader scrolls past. It would also serialize behind
 * every other action in flight, which is the right thing for writes and the
 * wrong thing for scrolling.
 *
 * Authorization runs on every request and the reply is `private, no-store`:
 * these rows are one group's financial history, and the page a reader is on is
 * not something to leave in a shared cache. An unauthorized group answers 404
 * for the same reason the export does — so group existence cannot be probed.
 */

export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/transactions">,
) {
  return trackRoute("/api/groups/[groupId]/transactions", "GET", () =>
    handleGet(request, context),
  );
}

async function handleGet(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/transactions">,
) {
  const { groupId } = await context.params;
  const params = new URL(request.url).searchParams;
  // A cursor this server did not write reads as no cursor at all, which starts
  // the list again from the top. There is nothing to report: the value is
  // opaque to the client, so a malformed one is a bug or a fiddled URL, and
  // neither is worth a failed screen.
  const cursor = decodeCursor(params.get("cursor"));
  const limit = pageSize(params.get("limit"));

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    const page = await loadTransactionPage(access, { cursor, limit });

    return NextResponse.json(page, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AuthorizationError") {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (
      error instanceof Error &&
      error.name === "AuthenticationRequiredError"
    ) {
      return NextResponse.json(
        { error: "Sign in to continue." },
        { status: 401 },
      );
    }
    logger.error(
      { err: error instanceof Error ? error.message : String(error), groupId },
      "Transactions page failed",
    );
    return NextResponse.json({ error: "Unavailable." }, { status: 500 });
  }
}

/**
 * How many rows the caller may ask for.
 *
 * Scrolling takes them a screen at a time; searching asks for far more,
 * because a filter that only knows about the rows already scrolled past is a
 * filter that lies. `MAX` is what stops the second case from becoming "send me
 * the group" in one request.
 */
const MAX_PAGE = 500;

function pageSize(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return undefined;
  return Math.min(value, MAX_PAGE);
}
