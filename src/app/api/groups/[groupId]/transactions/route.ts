import { NextResponse } from "next/server";
import { apiActor, isUuid } from "@/app/api/mobile";
import { decodeCursor } from "@/lib/db/keyset";
import { authorizeGroup } from "@/lib/security/authorization";
import {
  countTransactions,
  loadTransactionPage,
} from "@/modules/expenses/transactions";
import { parseTransactionFilter } from "@/modules/expenses/transaction-filter";
import { logger } from "@/lib/logger";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The next page of a group's transactions — or, with `count`, how many there
 * are.
 *
 * A route handler rather than a Server Action because this is a read. An
 * action would return the re-rendered page alongside its result — the whole
 * screen, the category spread and the first page of rows built again — for
 * every forty rows the reader scrolls past. It would also serialize behind
 * every other action in flight, which is the right thing for writes and the
 * wrong thing for scrolling.
 *
 * The list's filters ride along as the same parameters the screen keeps in
 * its own URL (`q`, `cat`, `kind`, `when`, …), and the page comes back already
 * narrowed and ordered. Every one of them is optional; a request with none is
 * the list as it always was, newest first, which is what an older client
 * still sends. `count` answers `{ count }` over the same filter, for the
 * filter sheet's `Show 4 transactions`.
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
  // Before any query: PostgreSQL throws on a malformed UUID, which would
  // answer 500 for what is only a group that does not exist.
  if (!isUuid(groupId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const params = new URL(request.url).searchParams;
  // A cursor this server did not write reads as no cursor at all, which starts
  // the list again from the top. There is nothing to report: the value is
  // opaque to the client, so a malformed one is a bug or a fiddled URL, and
  // neither is worth a failed screen.
  const cursor = decodeCursor(params.get("cursor"));
  const limit = pageSize(params.get("limit"));
  // Unlike a cursor, a filter that is out of bounds is refused rather than
  // ignored: dropping it would answer a different question than the one asked,
  // and a list that quietly stopped filtering looks exactly like one that
  // found every row.
  const filter = parseTransactionFilter(params);

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/transactions",
      "GET",
    );
    const access = await authorizeGroup(actor, groupId);
    if (filter === null) {
      return NextResponse.json(
        { error: "That filter is not one this list can apply." },
        { status: 400 },
      );
    }

    const body = params.has("count")
      ? { count: await countTransactions(access, { filter }) }
      : await loadTransactionPage(access, { cursor, limit, filter });

    return NextResponse.json(body, {
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
    // An API key that will not do — read-only, pinned elsewhere. By name
    // rather than by class, like the two above: this catch dispatches on
    // `error.name` throughout, and one branch importing a constructor while
    // its neighbours do not would read as a distinction that isn't there.
    if (error instanceof Error && error.name === "TokenScopeError") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    logger.error({ err: error, groupId }, "Transactions page failed");
    return NextResponse.json({ error: "Unavailable." }, { status: 500 });
  }
}

/**
 * How many rows the caller may ask for.
 *
 * Scrolling takes them a screen at a time, and so does searching now that the
 * filter is applied here. The one reader who asks for more is one coming back
 * from an entry to a place far down the list, who needs every row above it
 * back in one go. `MAX` is what stops that from becoming "send me the group"
 * in one request.
 */
const MAX_PAGE = 500;

function pageSize(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return undefined;
  return Math.min(value, MAX_PAGE);
}
