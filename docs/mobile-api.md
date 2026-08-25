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

`POST /api/auth/register` is `registerUser` over JSON — `{name, email,
password}` → 201 `{user, verificationRequired}` under the `signUp` rate
bucket. With SMTP configured the instance mails a confirmation and issues no
session; without it the session cookie is set right away, like the web form.
Registration refusals (email taken, registration closed, password policy) are
422, not the 401 a failed sign-in maps to.

## Reads

| Method | Path                                                     | Body of the answer                                                                                                                                                                                                                   |
| ------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/groups`                                            | The home screen: `loadHomeOverview` serialized — buckets (`needsYou`, `youAreOwed`, `settled`, `archived`), net position, per-currency totals. Users only; guests get 403 and read their one group directly.                         |
| GET    | `/api/groups/:groupId`                                   | One group as its screen opens: the access (`group`, `role`, `participantId`, `permissions`), active participants, and `loadGroupOverview` (positions, per-currency overviews, balance rows, suggested repayments, spending periods). |
| GET    | `/api/groups/:groupId/expenses?limit&offset`             | `listExpenses`, newest first, payers and shares resolved.                                                                                                                                                                            |
| GET    | `/api/groups/:groupId/expenses/:expenseId`               | One expense **with `splitInput`**, so an edit form reopens at what was typed.                                                                                                                                                        |
| GET    | `/api/groups/:groupId/settlements?limit`                 | `listSettlements`, newest first.                                                                                                                                                                                                     |
| GET    | `/api/groups/:groupId/settlements/:settlementId`         | One settlement **with `paymentMethod`** (the list omits it on purpose — see `getSettlement`).                                                                                                                                        |
| GET    | `/api/groups/:groupId/expenses/:expenseId/attachments`   | The receipts on one expense (`id`, `fileName`, `contentType`, `byteSize`); bytes come from the per-attachment download route.                                                                                                        |
| GET    | `/api/groups/:groupId/participants`                      | The People screen's rows: `listParticipants` with the invitation state (`hasActiveInvitation`, created/expires/last-used instants). Also inlined in the group read.                                                                  |
| GET    | `/api/groups/:groupId/activity?limit`                    | `listGroupActivity`, newest first (default 100, max 200).                                                                                                                                                                            |
| GET    | `/api/groups/:groupId/recurring`                         | `listRecurringExpenses`: templates with their schedule, `nextRunAt`, `pausedAt`, `generatedCount`.                                                                                                                                   |
| GET    | `/api/groups/:groupId/reminders`                         | `listRemindRecipients`: who owes the reader, per-currency debts, the channel a message would take, and the 24-hour lock state.                                                                                                       |
| GET    | `/api/groups/:groupId/categories`                        | The picker's suggestion data: `loadFrequentCategories` + `loadMappings` (group's own plus the reader's learned merchants).                                                                                                           |
| POST   | `/api/groups/:groupId/categorize`                        | What a description is about: `classifyTransactionSync` against this group's learned mappings. Body `{description, note?, recurring?}`; answers `{classification}` or `{classification: null}` with nothing to go on.                 |
| GET    | `/api/groups/:groupId/join-link`                         | The live group-wide link's prefix and age, or `{link: null}`. The token itself only ever exists in the POST answer.                                                                                                                  |
| GET    | `/api/groups/:groupId/transactions?cursor&limit`         | One page of the group's history, expenses and repayments in one list, newest first (40 by default, 500 at most). Feed `cursor` back for the next page; a null cursor is the end.                                                     |
| GET    | `/api/groups/:groupId/stats`                             | `loadGroupStats`: all three windows, every currency and the all-time records in one read.                                                                                                                                            |
| GET    | `/api/groups/:groupId/participants/:participantId/stats` | `loadMemberStats` for one member, removed people included.                                                                                                                                                                           |
| GET    | `/api/groups/:groupId/settle-up`                         | `loadSettleUp`: the shortest set of transfers that clears the group, split into the reader's own and everybody else's.                                                                                                               |
| GET    | `/api/notifications?limit&before`                        | The inbox plus `unread`. Users only.                                                                                                                                                                                                 |
| GET    | `/api/notifications/preferences`                         | Category switches plus `mutedGroupIds`.                                                                                                                                                                                              |

Every read that carries a `category` carries a `subcategory` beside it, which
is null far more often than not: the second level is optional everywhere, and
an expense filed under a category with nothing beneath it is complete rather
than half-entered. A write may send one, and the server refuses a pair that
does not agree — `restaurants` + `fuel` is a 422, and so is a subcategory hung
on free text an import kept verbatim.

The group read also carries `profile` (`description`, `icon`, `iconColor` via
`getGroupProfile`), which `GroupAccess` deliberately omits.

The two statistics reads answer with the whole screen rather than one window of
it. Three ranges, every currency and the all-time records come out of the same
rows, so a range switcher costs no round trip and two blocks cannot show
figures read at different instants. Percentages cross as JSON numbers: they are
ratios the server has already rounded to the decimal the screens print, not
money, and nothing downstream does arithmetic on them. Every amount is still a
string of minor units.

The group read carries the same balances twice, on purpose. `rows` and
`suggestions` are flattened across currencies, which is what a group with one
currency reads; `currencies` keeps them apart, each entry holding that
currency's own members, transfers, spend and the reader's position in it. A
group balancing in three currencies has three of everything and never a total,
so the flat lists cannot answer for it — and regrouping them on the client
would put an ordering the server has already decided back in the client's
hands.

`currencies.length` is also the rule for which overview a group gets: more than
one and the screen collapses per currency, which is the shape that exists to
stop a group's balances growing by a screenful per currency. Count it rather
than reading the group's `currencyMode` — a group kept in separate currencies
that has so far only spent in one is a one-currency group today, whatever it is
configured to become.

`categorize` exists because the browser does not need it. The web runs the
same classifier locally, between keystrokes and with the network gone, and a
phone cannot have that without carrying the rules — three and a half thousand
lines of merchants and phrases that grow every week. Transcribing them into a
second language is how the two ends start disagreeing about what `Migros` is,
which is why the category vocabulary is read from the message catalogues
rather than copied. So the phone asks, debounced, and does without an answer
when it cannot reach the server. Only the deterministic pass runs: the
semantic one needs an embedder in a worker, and the browser does not wait for
it either — what a reader sees first is this.

`settle-up` fills `lastSettled` only when nothing is left to settle — it is the
one screen with room for it. Read an empty list as "no room for it here", never
as "this group has never settled anything".

## Writes

| Method | Path                                               | Body                                                                                                                             |
| ------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/groups/:groupId/expenses`                    | `expenseInputSchema` → 201 `{expenseId}`                                                                                         |
| PATCH  | `/api/groups/:groupId/expenses/:expenseId`         | `expenseInputSchema` (full replace, like `updateExpense`)                                                                        |
| DELETE | `/api/groups/:groupId/expenses/:expenseId`         | soft delete                                                                                                                      |
| POST   | `/api/groups/:groupId/expenses/:expenseId/restore` | undo for the delete; the expense comes back under its own id, payers and shares intact                                           |
| POST   | `/api/groups/:groupId/settlements`                 | `settlementInputSchema` → 201 `{settlementId}`                                                                                   |
| PATCH  | `/api/groups/:groupId/settlements/:settlementId`   | `settlementInputSchema`                                                                                                          |
| DELETE | `/api/groups/:groupId/settlements/:settlementId`   | soft delete                                                                                                                      |
| POST   | `/api/groups/:groupId/settlements/:id/restore`     | undo for the delete                                                                                                              |
| POST   | `/api/groups`                                      | `createGroupSchema` → 201 `{groupId, participantId}`. `ownerDisplayName` defaults to the account name.                           |
| PATCH  | `/api/groups/:groupId`                             | `updateGroupSchema` fields when `name`/`timezone` are present, and/or `{archived: boolean}` — either half may come alone.        |
| DELETE | `/api/groups/:groupId`                             | **hard** delete, like the web's danger zone                                                                                      |
| POST   | `/api/groups/:groupId/participants`                | `{displayName, email?}` → 201 `{participantId}`                                                                                  |
| PATCH  | `/api/groups/:groupId/participants/:id`            | `{displayName, email?}`                                                                                                          |
| DELETE | `/api/groups/:groupId/participants/:id`            | soft remove; revokes their invitation and guest sessions                                                                         |
| POST   | `/api/groups/:groupId/participants/:id/restore`    | undo for the remove (the invitation stays gone — only its hash was kept)                                                         |
| POST   | `/api/groups/:groupId/participants/:id/invitation` | `{expiresInDays?}` → 201 `{url, expiresAt}`, shown once                                                                          |
| DELETE | `/api/groups/:groupId/participants/:id/invitation` | revoke                                                                                                                           |
| POST   | `/api/groups/:groupId/join-link`                   | `{expiresInDays?}` → 201 `{url, expiresAt}`, shown once                                                                          |
| DELETE | `/api/groups/:groupId/join-link`                   | revoke                                                                                                                           |
| POST   | `/api/groups/:groupId/recurring`                   | `recurringInputSchema` → 201 `{id}`                                                                                              |
| PATCH  | `/api/groups/:groupId/recurring/:templateId`       | `{paused: boolean}`                                                                                                              |
| DELETE | `/api/groups/:groupId/recurring/:templateId`       | delete the template; generated expenses stay                                                                                     |
| POST   | `/api/groups/:groupId/recurring/:id/restore`       | undo for the delete; the worker picks the schedule up again on its next tick                                                     |
| POST   | `/api/groups/:groupId/reminders`                   | `{toParticipantId, message, logToActivity?}` → `RemindResult`; the debt and channel are re-derived server-side, refusals are 422 |
| PUT    | `/api/groups/:groupId/mute`                        | `{muted: boolean}` — per-user, needs an account                                                                                  |
| POST   | `/api/notifications/read`                          | `{ids?: [uuid]}`; omit to mark all read                                                                                          |
| PUT    | `/api/notifications/preferences`                   | all five category booleans                                                                                                       |
| PATCH  | `/api/profile`                                     | `{preferredCurrency?: code\|null, favoriteCurrencies?: [code]}`                                                                  |
| GET    | `/api/profile/avatar`                              | the caller's own photo, or 404; never anybody else's                                                                             |
| POST   | `/api/profile/avatar`                              | `multipart/form-data` with `file`; type is sniffed, 1 MB cap, replaces and sweeps the old one                                    |
| DELETE | `/api/profile/avatar`                              | 204; the account goes back to its initial                                                                                        |
| DELETE | `/api/push/subscriptions/:id`                      | forget one device by its row id — the endpoint form is how a browser unsubscribes itself                                         |

Every restore refuses a row that is not deleted, so a client may replay one
safely: a second call answers 404 rather than writing a second event about
something that never left.

Writes require the group to be active (`requireActive`), matching the actions
— except the group's own PATCH/DELETE, which must work on an archived group
(restoring is a write too). The pre-existing routes complete the picture for a
mobile client: receipts upload to `POST /api/groups/:groupId/attachments`,
`GET /api/groups/:groupId/export?format=json|csv|xlsx` downloads the group,
and `GET /api/rates?from&to&on` suggests an exchange rate.

## CSRF

`src/proxy.ts` rejects cross-origin non-GET requests _when an `Origin` header
is present and does not match the host_. Native URL-loading stacks send no
`Origin`, so they pass; browsers send one, so the cookie still cannot be
ridden cross-site. Do not add an `Origin` header to a native client.
