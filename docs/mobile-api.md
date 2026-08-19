# The mobile API

The web app never needed HTTP endpoints for the core domain — Server
Components read the services directly and Server Actions write through them.
A native client can do neither: the RSC protocol's action IDs change on every
build. So `src/app/api/mobile.ts` and a set of thin route handlers expose the
same service calls over plain JSON, for the iOS app in `ios/` and anything
else that speaks HTTP.

Nothing here adds business logic. Every handler is the same three steps as a
Server Action — validate with the shared zod schema, resolve an authorized
actor, call the domain service — and the schemas _are_ the contract:
`expenseInputSchema` and `settlementInputSchema` from
`src/modules/expenses/schemas.ts` validate the write bodies verbatim, so the
two clients cannot drift apart on what an expense is.

## Conventions

Same rules as everywhere else in Balancia, restated because a client author
lands here first:

- **Money is a decimal string of integer minor units** (`"6390"` for €63.90),
  never a JSON number. Currency exponents vary (JPY 0, KWD 3) — see
  `src/modules/currencies/iso-4217.ts`.
- **Exchange rates are decimal strings**, `1 source = rate target`.
- **Calendar dates are `YYYY-MM-DD` strings** with no timezone; instants are
  ISO 8601.
- **Authorization failures are 404**, indistinguishable from a group that does
  not exist (same rule as the export route). Missing authentication is 401.
  Refusals a person should read (a bad split, a rate limit) are 422 / 429 with
  `{"error": "..."}`.
- Every response is `Cache-Control: private, no-store`.

## Sessions

Cookie-based, exactly like the browser: `POST /api/auth/session` runs the same
rate limit and `signInWithPassword` as the sign-in action and sets the
`balancia_session` cookie; URLSession-style clients store and return it on
their own. No parallel token scheme to issue or revoke.

| Method | Path                | Notes                                                                                                    |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/session` | `{email, password}` → `{user}`, sets cookie. 401 on bad credentials, 429 under the `signIn` rate bucket. |
| GET    | `/api/auth/session` | Who am I: `{user, guest}` — `guest` names the one group a guest cookie is pinned to. 401 signed out.     |
| DELETE | `/api/auth/session` | Revokes the session and clears the cookie.                                                               |

Guests are not signed in here: the `/join/[token]` and `/join/g/[token]`
routes are already plain HTTP and set the guest cookie themselves.

## Reads

| Method | Path                                             | Body of the answer                                                                                                                                                                                           |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/groups`                                    | The home screen: `loadHomeOverview` serialized — buckets (`needsYou`, `youAreOwed`, `settled`, `archived`), net position, per-currency totals. Users only; guests get 403 and read their one group directly. |
| GET    | `/api/groups/:groupId`                           | One group as its screen opens: the access (`group`, `role`, `participantId`, `permissions`), active participants, and `loadGroupOverview` (positions, balance rows, suggested repayments, spending periods). |
| GET    | `/api/groups/:groupId/expenses?limit&offset`     | `listExpenses`, newest first, payers and shares resolved.                                                                                                                                                    |
| GET    | `/api/groups/:groupId/expenses/:expenseId`       | One expense **with `splitInput`**, so an edit form reopens at what was typed.                                                                                                                                |
| GET    | `/api/groups/:groupId/settlements?limit`         | `listSettlements`, newest first.                                                                                                                                                                             |
| GET    | `/api/groups/:groupId/settlements/:settlementId` | One settlement **with `paymentMethod`** (the list omits it on purpose — see `getSettlement`).                                                                                                                |

## Writes

| Method | Path                                             | Body                                                      |
| ------ | ------------------------------------------------ | --------------------------------------------------------- |
| POST   | `/api/groups/:groupId/expenses`                  | `expenseInputSchema` → 201 `{expenseId}`                  |
| PATCH  | `/api/groups/:groupId/expenses/:expenseId`       | `expenseInputSchema` (full replace, like `updateExpense`) |
| DELETE | `/api/groups/:groupId/expenses/:expenseId`       | soft delete                                               |
| POST   | `/api/groups/:groupId/settlements`               | `settlementInputSchema` → 201 `{settlementId}`            |
| PATCH  | `/api/groups/:groupId/settlements/:settlementId` | `settlementInputSchema`                                   |
| DELETE | `/api/groups/:groupId/settlements/:settlementId` | soft delete                                               |

Writes require the group to be active (`requireActive`), matching the actions.
The pre-existing routes complete the picture for a mobile client: receipts
upload to `POST /api/groups/:groupId/attachments`, and
`GET /api/rates?from&to&on` suggests an exchange rate.

## CSRF

`src/proxy.ts` rejects cross-origin non-GET requests _when an `Origin` header
is present and does not match the host_. Native URL-loading stacks send no
`Origin`, so they pass; browsers send one, so the cookie still cannot be
ridden cross-site. Do not add an `Origin` header to a native client.
