/**
 * What an API token may reach, decided in one table.
 *
 * Every route under `src/app/api/` appears below exactly once, and the entry
 * says whether a bearer token may authenticate there at all. That direction
 * matters: this is an **allowlist**, so a route added next month is refused to
 * tokens until somebody writes it in — and `scope.test.ts` walks the directory
 * and fails the build while the two disagree, so nobody has to remember.
 *
 * A denylist would fail the other way round. The route somebody forgets is the
 * route that was added in a hurry, and a credential feature cannot have its
 * default be "reachable".
 *
 * **A route a key may never reach does not read the header at all.** Those
 * handlers still call `getCurrentActor()` / `getCurrentUser()` and are simply
 * blind to `Authorization`, which is a stronger guarantee than a check they
 * could stop performing: there is no branch to get wrong. So the refusals
 * below are two things at once — the reason, written where somebody will look
 * for it, and the row the completeness test counts. The one place the refusal
 * is also *live* is a route that shares a file with reachable methods, which
 * today means `DELETE /api/groups/[groupId]`.
 *
 * Pure on purpose: no database, no request, no `server-only`. What a token may
 * do is a function of two literals the route already writes down for
 * `trackRoute`, and keeping it a function is what lets every refusal below be
 * a table row in a test rather than a scenario somebody has to build.
 */

/** Read-only, or read and write. See `apiTokenScopeEnum`. */
export type TokenScope = "read" | "write";

/**
 * Why a token is refused a route it will never be allowed on.
 *
 * Four reasons, and each is a sentence somebody can act on rather than a
 * number. They are the message the API answers with, so they are written for
 * whoever is holding the token and wondering why their script stopped.
 */
export type TokenRefusal =
  /** Sign-in, the profile, the push devices: the account itself. */
  | "account"
  /** Participants, invitations, join links, deleting a group: the door. */
  | "door"
  /** Whole-history download. See the note on `bulk` below. */
  | "bulk"
  /** A route that authenticates nobody — health, metrics, telemetry. */
  | "anonymous"
  /** Not in the table, or a method the table does not name. */
  | "unknown";

/**
 * `open` means a token may reach this route, at the scope its method implies:
 * `GET` and `HEAD` need `read`, everything else needs `write`.
 *
 * `stateless` is `open` plus one thing: the route answers out of the caller's
 * own request and touches no stored data, so a *pinned* key may use it too.
 * See `pinnable` below for why that needs saying. Anything else is the reason
 * the route is refused.
 */
type RouteRule = "open" | "stateless" | TokenRefusal;

/** One rule for the whole route, or one per method where they differ. */
type RouteEntry = RouteRule | Readonly<Record<string, RouteRule>>;

/**
 * Every route template under `src/app/api/`.
 *
 * The keys are the same literals the handlers pass to `trackRoute`, which is
 * what makes the resolver's `route` parameter typed rather than a string: a
 * route that passes a template not written here does not compile.
 *
 * On the refusals, since each was a decision rather than an oversight:
 *
 * **`account`** — `/api/auth/*`, `/api/profile/*` and `/api/push/*`. A token
 * is a narrower thing than the account that minted it, so it must not be able
 * to reach back and change the account, read the address and payout details on
 * it, or unsubscribe somebody's phone. The auth routes are also where
 * credentials are *made*, and a credential resolver standing in front of one
 * would be circular.
 *
 * **`door`** — who is in a group and who can get in. Participants, personal
 * invitations, the group-wide join link, and the group's own DELETE. A token
 * that could mint an invitation could hand somebody a permanent way into a
 * group its owner never agreed to, which is a wider power than any of the
 * money routes it is allowed on.
 *
 * **`bulk`** — the export. Not about secrecy: a `read` token can already page
 * through every expense in the group. It is that a bearer credential may be
 * forwarded, and a one-request download of a group's entire financial history
 * is a sharper tool in the wrong hands than the same data read a page at a
 * time. That is the same sentence `GUEST_PERMISSIONS` in
 * `security/authorization.ts` is written under, and for the same reason: an
 * invitation link and an API key are both things somebody can be talked out of.
 *
 * **`anonymous`** — health, metrics, telemetry and the onboarding counter
 * resolve no actor at all. They are here so the table is provably complete,
 * not because anything checks them.
 */
export const API_ROUTES = {
  // The account, and the doors into it.
  "/api/auth/apple/callback": "account",
  "/api/auth/apple/start": "account",
  "/api/auth/challenge": "account",
  "/api/auth/code": "account",
  "/api/auth/options": "account",
  "/api/auth/passkey": "account",
  "/api/auth/passkey/authenticate": "account",
  "/api/auth/passkey/register": "account",
  "/api/auth/passkey/signal": "account",
  "/api/auth/passkey/signup": "account",
  "/api/auth/passkey/upgrade": "account",
  "/api/auth/register": "account",
  "/api/auth/session": "account",
  "/api/profile": "account",
  "/api/profile/avatar": "account",
  "/api/profile/payouts": "account",
  "/api/push/key": "account",
  "/api/push/subscriptions": "account",
  "/api/push/subscriptions/[id]": "account",
  "/api/push/test": "account",

  // The door into a group.
  "/api/join/[token]": "door",
  "/api/join/g/[token]": "door",
  "/api/groups/[groupId]/join-link": "door",
  "/api/groups/[groupId]/participants": "door",
  "/api/groups/[groupId]/participants/[participantId]": "door",
  "/api/groups/[groupId]/participants/[participantId]/invitation": "door",
  "/api/groups/[groupId]/participants/[participantId]/restore": "door",
  "/api/groups/[groupId]/participants/[participantId]/stats": "door",

  // The whole history in one request.
  "/api/groups/[groupId]/export": "bulk",

  // The money, which is what a key is for.
  "/api/groups": "open",
  // GET and PATCH are an ordinary read and an ordinary write — archiving a
  // group is a write like any other. DELETE is not: it takes the group and
  // everybody's history with it, permanently, and nothing a script does
  // routinely needs that.
  "/api/groups/[groupId]": { GET: "open", PATCH: "open", DELETE: "door" },
  "/api/groups/[groupId]/activity": "open",
  "/api/groups/[groupId]/attachments": "open",
  "/api/groups/[groupId]/attachments/[attachmentId]": "open",
  "/api/groups/[groupId]/categories": "open",
  "/api/groups/[groupId]/categorize": "open",
  "/api/groups/[groupId]/expenses": "open",
  "/api/groups/[groupId]/expenses/[expenseId]": "open",
  "/api/groups/[groupId]/expenses/[expenseId]/attachments": "open",
  "/api/groups/[groupId]/expenses/[expenseId]/restore": "open",
  "/api/groups/[groupId]/mute": "open",
  "/api/groups/[groupId]/receipt-scan": "open",
  "/api/groups/[groupId]/recurring": "open",
  "/api/groups/[groupId]/recurring/[templateId]": "open",
  "/api/groups/[groupId]/recurring/[templateId]/restore": "open",
  "/api/groups/[groupId]/reminders": "open",
  "/api/groups/[groupId]/settle-up": "open",
  "/api/groups/[groupId]/settlements": "open",
  "/api/groups/[groupId]/settlements/[settlementId]": "open",
  "/api/groups/[groupId]/settlements/[settlementId]/restore": "open",
  "/api/groups/[groupId]/stats": "open",
  "/api/groups/[groupId]/transactions": "open",
  "/api/notifications": "open",
  "/api/notifications/preferences": "open",
  "/api/notifications/read": "open",

  // Answered out of the request and nothing else: a published reference rate
  // is nobody's data, and a parse is a regular expression over a sentence the
  // caller supplied. Neither reads a row, so neither can tell a pinned key
  // anything about a group it was not pinned to — which is what `stateless`
  // says. It matters because these two are exactly what the share-sheet
  // Shortcut this feature exists for reaches for on its way to writing an
  // entry: refusing a pinned key here would leave it able to file an expense
  // and unable to work out what the sentence said or what the rate was.
  "/api/parse": "stateless",
  "/api/rates": "stateless",

  // Nobody is authenticated here.
  "/api/health/live": "anonymous",
  "/api/health/ready": "anonymous",
  "/api/metrics": "anonymous",
  "/api/onboarding/step": "anonymous",
  "/api/telemetry/v1/crash": "anonymous",
  "/api/telemetry/v1/report": "anonymous",
} as const satisfies Readonly<Record<string, RouteEntry>>;

/**
 * A route template this API serves.
 *
 * The resolver takes one of these rather than a string, so a handler that
 * mistypes its own path — or adds one nobody has decided about — fails to
 * compile rather than silently landing on the "unknown" refusal at runtime.
 */
export type ApiRoute = keyof typeof API_ROUTES;

export type ScopeDecision =
  | {
      readonly allowed: true;
      /** The scope a token must carry to pass. */
      readonly requires: TokenScope;
      /**
       * Whether a key pinned to one group may be used here.
       *
       * True two ways. A route that names a group can check the pin, and
       * `authorizeGroup` does — before it fetches anything, beside the
       * identical rule for guests. A `stateless` route has nothing to check
       * and nothing to widen to: it answers out of the request body and reads
       * no stored data, so which group the key names cannot change what comes
       * back.
       *
       * False for the rest, and that is the case this field exists for: on a
       * route like `GET /api/groups` or the notification inbox there is no
       * group id for the pin to be compared against, so a pinned key would
       * silently read across every group its owner is in. Refused instead.
       */
      readonly pinnable: boolean;
    }
  | { readonly allowed: false; readonly reason: TokenRefusal };

/** Safe methods read; everything else writes. */
export function scopeForMethod(method: string): TokenScope {
  return method === "GET" || method === "HEAD" ? "read" : "write";
}

/**
 * What a token needs to reach `route` with `method`, if it can reach it at all.
 *
 * The whole decision, and the only one: a caller that has this answer needs to
 * ask nothing else about scope.
 */
export function decideScope(route: string, method: string): ScopeDecision {
  const entry: RouteEntry | undefined = (
    API_ROUTES as Readonly<Record<string, RouteEntry>>
  )[route];
  if (entry === undefined) return { allowed: false, reason: "unknown" };

  // A method map names the methods the handler implements. One it does not
  // name is a route/method pair nobody has decided about, which is the same
  // answer as a route nobody has decided about.
  const rule: RouteRule | undefined =
    typeof entry === "string" ? entry : entry[method];
  if (rule === undefined) return { allowed: false, reason: "unknown" };
  if (rule !== "open" && rule !== "stateless") {
    return { allowed: false, reason: rule };
  }

  return {
    allowed: true,
    requires: scopeForMethod(method),
    pinnable: rule === "stateless" || route.includes("[groupId]"),
  };
}

/** Whether a token holding `held` satisfies a route that wants `needed`. */
export function scopeSatisfies(held: TokenScope, needed: TokenScope): boolean {
  return held === "write" || needed === "read";
}

/**
 * A token was presented and will not do — 403, with a sentence.
 *
 * Deliberately not an `AuthorizationError`, which the API answers 404 to so
 * that group ids cannot be probed. Nothing is being probed here: the caller
 * already holds the key and is being told a fact about the key itself, which
 * they need in order to mint a better one. Answering 404 would send somebody
 * hunting for a group id that was never the problem.
 */
export class TokenScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenScopeError";
  }
}

/** Why this route will never open, in the words the API answers with. */
export function refusalMessage(reason: TokenRefusal): string {
  switch (reason) {
    case "account":
      return "API keys cannot reach the account itself. Sign in for this.";
    case "door":
      return "API keys cannot change who is in a group or who can get in.";
    case "bulk":
      return "API keys cannot export a group. Read the entries a page at a time.";
    case "anonymous":
    case "unknown":
      return "API keys cannot reach this endpoint.";
  }
}
