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
their own. That is the way in for a client acting _as the person_ — a native
app, a browser, anything with a screen to type a password into.

Software that is not a person holding a phone should not hold a session cookie
at all. A Shortcut, a cron script, a wall tablet and an MCP server each want
something narrower and revocable, and that is [an API key](#api-keys) below: a
bearer credential the account mints for itself, scoped to reading or writing,
optionally pinned to one group, and refused outright on the account and the
door. The two schemes never mix on one request — see _Which credential
answered_ below.

| Method | Path                | Notes                                                                                                                                                                   |
| ------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/session` | `{email, password}` → `{user}`, sets cookie. 401 on bad credentials, 429 under the `signIn` rate bucket.                                                                |
| POST   | `/api/auth/session` | `{email, code}` — the six digits `POST /api/auth/code` mailed — → `{user}`, sets cookie. 401 on a wrong or expired code, 429 under `verifyCode`, keyed by address.      |
| POST   | `/api/auth/code`    | `{email}` → `{ok: true}`, always, whether or not the address has an account. Mails a sign-in code under the `signInCode` bucket; 422 on an instance without SMTP.       |
| GET    | `/api/auth/options` | Anonymous: `{password, code, passkey, apple}` — which ways in this instance offers, so a client hides a button before offering one that cannot work.                    |
| GET    | `/api/auth/session` | Who am I: `{user, guest}` — `guest` names the one group a guest cookie is pinned to; `user.accentColor` is an accent _name_ (see `docs/appearance.md`). 401 signed out. |
| DELETE | `/api/auth/session` | Revokes the session and clears the cookie.                                                                                                                              |

Guests are not signed in here: the `/join/[token]` and `/join/g/[token]`
routes are already plain HTTP and set the guest cookie themselves — see
_Invitation links_ below for how a native client redeems one.

### Signing in with a mailed code

An account created with a code or a passkey on another device has no password,
and "Incorrect email or password" is the sentence it used to get from a native
client. `POST /api/auth/code` is the web's "Email me a sign-in code" over JSON:
it mails six digits to the address if there is an account behind it, and
answers `{ok: true}` either way — which addresses are registered is not this
route's to say. The code is then the proof on `POST /api/auth/session`, in place
of the password:

```json
{ "email": "…", "code": "482 913" }
```

Spaces and anything else that is not a digit are dropped before the code is
checked, so what iOS offers from the keyboard works as typed. A code lives ten
minutes and works once; a wrong guess does not spend it, but the address's
`verifyCode` bucket bounds how many may be tried. Asking for another code
retires the one before it, so a client should wait on the first mail rather
than tap twice — the web's button counts down thirty seconds for exactly that
reason.

`GET /api/auth/options` says whether the instance can do this at all — `code`
is false without SMTP, and on the public demo — and, beside it, whether Sign in
with Apple is configured. The web's page knows these when it renders and hides
the buttons that cannot work; a native client reads them here before laying out
its screen, because the instance it is pointed at may be anybody's.

`POST /api/auth/register` is `registerUser` over JSON — `{name, email,
password}` → 201 `{user, verificationRequired}` under the `signUp` rate
bucket. With SMTP configured the instance mails a confirmation and issues no
session; without it the session cookie is set right away, like the web form.
Registration refusals (email taken, registration closed, password policy) are
422, not the 401 a failed sign-in maps to.

### Creating an account may cost a second of work

An instance may set
[`SIGNUP_PROOF_OF_WORK`](environment.md#signup_proof_of_work), and then every
door to account creation — this route, `POST /api/auth/passkey/signup`, and the
web's own forms — refuses a signup that does not carry a solved challenge.

`GET /api/auth/challenge` is how a client finds out, and it answers on an
instance that wants nothing as readily as on one that does:

```json
{ "enabled": false }
```

```json
{
  "enabled": true,
  "algorithm": "SHA-256",
  "nonce": "b9Vd…",
  "challenge": "3f7c…",
  "maxNumber": 150000
}
```

`challenge` is the hex SHA-256 of `nonce` followed by a number the server drew
below `maxNumber`. Count from zero until the hashes match — there is no
shortcut, which is the point — and send the number back on the signup:

```json
{
  "name": "…",
  "email": "…",
  "password": "…",
  "proofOfWork": { "nonce": "b9Vd…", "number": 91422 }
}
```

A challenge is good for fifteen minutes and for exactly one signup: the answer
is spent whether or not the account was created, so a signup refused for some
other reason needs a fresh challenge before the retry. A missing or spent
answer on an instance that wants one is a 422 from `/register` and a 400 from
the passkey route.

Ask for the challenge when the signup screen opens rather than when the button
is pressed. On a phone the search takes about a second, and it should happen
while somebody is still typing.

A client that never implements any of this keeps working everywhere the setting
is off, which is the default.

## Reads

| Method | Path                                                     | Body of the answer                                                                                                                                                                                                                                                                                                                |
| ------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/groups`                                            | The home screen: `loadHomeOverview` serialized — buckets (`needsYou`, `youAreOwed`, `settled`, `archived`), net position, per-currency totals. Users only; guests get 403 and read their one group directly.                                                                                                                      |
| GET    | `/api/groups/:groupId`                                   | One group as its screen opens: the access (`group`, `role`, `participantId`, `permissions`), active participants, and `loadGroupOverview` (positions, per-currency overviews, balance rows, suggested repayments, spending periods).                                                                                              |
| GET    | `/api/groups/:groupId/expenses?limit&offset`             | `listExpenses`, newest first, payers and shares resolved.                                                                                                                                                                                                                                                                         |
| GET    | `/api/groups/:groupId/expenses/:expenseId`               | One expense **with `splitInput`**, so an edit form reopens at what was typed.                                                                                                                                                                                                                                                     |
| GET    | `/api/groups/:groupId/settlements?limit`                 | `listSettlements`, newest first.                                                                                                                                                                                                                                                                                                  |
| GET    | `/api/groups/:groupId/settlements/:settlementId`         | One settlement **with `paymentMethod`** (the list omits it on purpose — see `getSettlement`).                                                                                                                                                                                                                                     |
| GET    | `/api/groups/:groupId/expenses/:expenseId/attachments`   | The receipts on one expense (`id`, `fileName`, `contentType`, `byteSize`); bytes come from the per-attachment download route.                                                                                                                                                                                                     |
| GET    | `/api/groups/:groupId/participants`                      | The People screen's rows: `listParticipants` with the invitation state (`hasActiveInvitation`, created/expires/last-used instants). Also inlined in the group read.                                                                                                                                                               |
| GET    | `/api/groups/:groupId/activity?limit`                    | `listGroupActivity`, newest first (default 100, max 200).                                                                                                                                                                                                                                                                         |
| GET    | `/api/groups/:groupId/recurring`                         | `listRecurringExpenses`: templates with their schedule, `nextRunAt`, `pausedAt`, `generatedCount`.                                                                                                                                                                                                                                |
| GET    | `/api/groups/:groupId/reminders`                         | `listRemindRecipients`: who owes the reader, per-currency debts, the channel a message would take, the 24-hour lock state, and `payWith` — the reader's own ways of being paid this particular debt, each `{method, kind, text, code}`, ordered as they ranked them. See `docs/settling-up.md`.                                   |
| GET    | `/api/groups/:groupId/categories`                        | The picker's suggestion data: `loadFrequentCategories` + `loadMappings` (group's own plus the reader's learned merchants).                                                                                                                                                                                                        |
| POST   | `/api/groups/:groupId/categorize`                        | What a description is about: `classifyTransactionSync` against this group's learned mappings. Body `{description, note?, recurring?}`; answers `{classification}` or `{classification: null}` with nothing to go on.                                                                                                              |
| GET    | `/api/groups/:groupId/join-link`                         | The newest group-wide link — `{status, url, prefix, createdAt, expiresAt, lastUsedAt}` — or `{link: null}`. Owner only, like the card it draws. `url` is null for a link minted before the token gained a sealed copy, or under a since-rotated `AUTH_SECRET`: it still works for everyone holding it, but cannot be shown again. |
| GET    | `/api/groups/:groupId/transactions?cursor&limit`         | One page of the group's history, expenses and repayments in one list, newest first (40 by default, 500 at most). Feed `cursor` back for the next page; a null cursor is the end.                                                                                                                                                  |
| GET    | `/api/groups/:groupId/stats`                             | `loadGroupStats`: all three windows, every currency and the all-time records in one read.                                                                                                                                                                                                                                         |
| GET    | `/api/groups/:groupId/participants/:participantId/stats` | `loadMemberStats` for one member, removed people included.                                                                                                                                                                                                                                                                        |
| GET    | `/api/groups/:groupId/settle-up`                         | `loadSettleUp`: the shortest set of transfers that clears the group, split into the reader's own and everybody else's.                                                                                                                                                                                                            |
| GET    | `/api/notifications?limit&before`                        | The inbox plus `unread`. Users only.                                                                                                                                                                                                                                                                                              |
| GET    | `/api/notifications/preferences`                         | Category switches plus `mutedGroupIds`.                                                                                                                                                                                                                                                                                           |

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

It also carries `payoutHints`: how to pay each debt the reader has been told
they owe, matched to a row by `participantId` **and** `currency`. One hint per
debt rather than per person, because a payment code is made of a debt — in a
group balancing in two currencies you can owe the same person twice, and one
code naming one amount would be wrong on one of those rows. `methods` is the
recipient's whole list in their own order; which of them the reader can
actually use is a fact about the reader, and this side of the wire knows none
of it. `qr` is built only for a bank transfer and only when the standard has
everything it needs, and `qrMissing` says why there is none when that is
something the reader can act on — otherwise it is null and stays silent.

These details are readable by exactly the people who owe their owner money,
and that is structural rather than checked: a recipient reaches the list only
by appearing in a transfer the group's own balances say the reader owes. There
is no route that takes a name and answers with an IBAN, and adding one would
be the mistake.

## Writes

| Method | Path                                               | Body                                                                                                                                                                                                                                      |
| ------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/groups/:groupId/expenses`                    | `expenseInputSchema` → 201 `{expenseId}`. Takes `Idempotency-Key` — see below                                                                                                                                                             |
| PATCH  | `/api/groups/:groupId/expenses/:expenseId`         | `expenseInputSchema` (full replace, like `updateExpense`)                                                                                                                                                                                 |
| DELETE | `/api/groups/:groupId/expenses/:expenseId`         | soft delete                                                                                                                                                                                                                               |
| POST   | `/api/groups/:groupId/expenses/:expenseId/restore` | undo for the delete; the expense comes back under its own id, payers and shares intact                                                                                                                                                    |
| POST   | `/api/groups/:groupId/settlements`                 | `settlementInputSchema` → 201 `{settlementId}`                                                                                                                                                                                            |
| PATCH  | `/api/groups/:groupId/settlements/:settlementId`   | `settlementInputSchema`                                                                                                                                                                                                                   |
| DELETE | `/api/groups/:groupId/settlements/:settlementId`   | soft delete                                                                                                                                                                                                                               |
| POST   | `/api/groups/:groupId/settlements/:id/restore`     | undo for the delete                                                                                                                                                                                                                       |
| POST   | `/api/groups`                                      | `createGroupSchema` → 201 `{groupId, participantId}`. `ownerDisplayName` defaults to the account name.                                                                                                                                    |
| PATCH  | `/api/groups/:groupId`                             | `updateGroupSchema` fields when `name`/`timezone` are present, and/or `{archived: boolean}` — either half may come alone.                                                                                                                 |
| DELETE | `/api/groups/:groupId`                             | **hard** delete, like the web's danger zone                                                                                                                                                                                               |
| POST   | `/api/groups/:groupId/participants`                | `{displayName, email?}` → 201 `{participantId}`                                                                                                                                                                                           |
| PATCH  | `/api/groups/:groupId/participants/:id`            | `{displayName, email?}`                                                                                                                                                                                                                   |
| DELETE | `/api/groups/:groupId/participants/:id`            | soft remove; revokes their invitation and guest sessions                                                                                                                                                                                  |
| POST   | `/api/groups/:groupId/participants/:id/restore`    | undo for the remove (the invitation stays gone — only its hash was kept)                                                                                                                                                                  |
| POST   | `/api/groups/:groupId/participants/:id/invitation` | `{expiresInDays?}` → 201 `{url, expiresAt}`, shown once                                                                                                                                                                                   |
| DELETE | `/api/groups/:groupId/participants/:id/invitation` | revoke                                                                                                                                                                                                                                    |
| POST   | `/api/groups/:groupId/join-link`                   | `{expiresInDays?}` → 201 `{url, expiresAt}`, shown once, owner only                                                                                                                                                                       |
| DELETE | `/api/groups/:groupId/join-link`                   | revoke, owner only                                                                                                                                                                                                                        |
| POST   | `/api/groups/:groupId/recurring`                   | `recurringInputSchema` → 201 `{id}`                                                                                                                                                                                                       |
| PATCH  | `/api/groups/:groupId/recurring/:templateId`       | `{paused: boolean}`                                                                                                                                                                                                                       |
| DELETE | `/api/groups/:groupId/recurring/:templateId`       | delete the template; generated expenses stay                                                                                                                                                                                              |
| POST   | `/api/groups/:groupId/recurring/:id/restore`       | undo for the delete; the worker picks the schedule up again on its next tick                                                                                                                                                              |
| POST   | `/api/groups/:groupId/reminders`                   | `{toParticipantId, message, logToActivity?}` → `RemindResult`; the debt and channel are re-derived server-side, refusals are 422                                                                                                          |
| PUT    | `/api/groups/:groupId/mute`                        | `{muted: boolean}` — per-user, needs an account                                                                                                                                                                                           |
| POST   | `/api/notifications/read`                          | `{ids?: [uuid]}`; omit to mark all read                                                                                                                                                                                                   |
| PUT    | `/api/notifications/preferences`                   | all five category booleans                                                                                                                                                                                                                |
| PATCH  | `/api/profile`                                     | `{name?, locale?, accentColor?: accent name, dateFormat?, numberFormat?, preferredCurrency?: code\|null, favoriteCurrencies?: [code]}` — any subset; `accentColor` is one of the seven names in `docs/appearance.md`, `"coral"` clears it |
| GET    | `/api/profile/payouts`                             | the caller's own `{methods, address}` — how they want to be paid back; never anybody else's                                                                                                                                               |
| PUT    | `/api/profile/payouts`                             | `{methods?: [{method, detail}], address?: {...}\|null}`; the whole ordered list, 422 `{method, reason}` on a rejected detail                                                                                                              |
| GET    | `/api/profile/avatar`                              | the caller's own photo, or 404; never anybody else's                                                                                                                                                                                      |
| POST   | `/api/profile/avatar`                              | `multipart/form-data` with `file`; type is sniffed, 1 MB cap, replaces and sweeps the old one                                                                                                                                             |
| DELETE | `/api/profile/avatar`                              | 204; the account goes back to its initial                                                                                                                                                                                                 |
| DELETE | `/api/push/subscriptions/:id`                      | forget one device by its row id — the endpoint form is how a browser unsubscribes itself                                                                                                                                                  |

Every restore refuses a row that is not deleted, so a client may replay one
safely: a second call answers 404 rather than writing a second event about
something that never left.

Writes require the group to be active (`requireActive`), matching the actions
— except the group's own PATCH/DELETE, which must work on an archived group
(restoring is a write too). The pre-existing routes complete the picture for a
mobile client: receipts upload to `POST /api/groups/:groupId/attachments`,
`GET /api/groups/:groupId/export?format=json|csv|xlsx` downloads the group,
and `GET /api/rates?from&to&on` suggests an exchange rate.

### Creating an expense exactly once

`POST /api/groups/:groupId/expenses` accepts an **`Idempotency-Key`** header,
and any client that queues writes should send one. A client that loses its
connection mid-request cannot tell "never arrived" from "arrived, and the
answer was lost on the way back"; without a key, retrying the second case
writes a second expense and the group's balances are quietly wrong.

- The value is a **UUID**, minted per entry, fixed before the first attempt and
  reused for every retry of that same entry. A malformed header is ignored
  rather than refused — a write landing once beats a 400 the client will retry
  forever — so a client that sends something else gets no protection at all.
- The key is recorded in the same transaction as the expense, so the two cannot
  disagree. A replay answers **201 with the `expenseId` the first call
  created** — the same answer, not a new expense. The route does not
  distinguish the two cases in its status, because no caller needs it to: the
  only question a queue has is whether the server has the entry, and 201 says
  it does either way.
- A key is spent for good, deletion included. A replay arriving after the entry
  was deleted returns that id and leaves the deletion standing.
- Scope is per group, so two devices may mint the same value without one
  group's write being mistaken for another's.

Only the expense create takes a key today. The browser's own offline queue
uses this exact route rather than the Server Action the form calls when it is
online, because an action is addressed by an id that changes on every build and
a queued entry has to survive a deploy — see [offline entry](offline.md).

## Invitation links

Two link shapes exist, both minted by the endpoints in _Writes_ above, both
carrying the token as the **last path segment** — never in the query string,
where it would reach a referrer.

| Shape             | What the token identifies             | Minted by                                                          |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------ |
| `/join/<token>`   | one named participant of one group    | `POST /api/groups/:groupId/participants/:participantId/invitation` |
| `/join/g/<token>` | the group, with nobody identified yet | `POST /api/groups/:groupId/join-link`                              |

The token is 32 random bytes base64url-encoded — 43 characters of
`[A-Za-z0-9_-]` — and `isWellFormedToken` accepts 40 to 64 of them. What is
matched on redemption is its SHA-256 hash, so no comparison ever needs the
token back; a sealed copy is kept beside the hash purely so the owner can be
shown the link again, and `GET /api/groups/:groupId/join-link` opens it. Where
that copy is missing — a link minted before the column existed, or sealed under
an `AUTH_SECRET` that has since rotated — the answer carries the eight-character
prefix and a null `url`, which is enough to name the live link in a UI and to
offer a fresh one instead.

Every call on the group-wide link is the owner's, through `manageInvitations`.
A member or a guest asking for it is answered 404, the same as somebody outside
the group: who else the group is open to is not theirs to read or to change.

### Redeeming one

**Reading a link and taking it are different calls.** That is the one thing
about this pair that is not negotiable, and it is why the web routes cannot be
reused: `GET /join/g/<token>` in a browser _spends_ the token — it sets a cookie
and redirects — so a client that fetched the web URL to find out what a link
was would have joined by accident. The token is gone either way.

| Method | Path                 | Auth      | Effect                          |
| ------ | -------------------- | --------- | ------------------------------- |
| GET    | `/api/join/g/:token` | anonymous | describes a group-wide link     |
| POST   | `/api/join/g/:token` | required  | takes it                        |
| GET    | `/api/join/:token`   | anonymous | describes a personal invitation |
| POST   | `/api/join/:token`   | required  | takes it                        |

The two namespaces mirror the web's rather than collapsing into one
`/api/join/:token`: the tokens live in different tables (`group_join_links` and
`guest_invitations`), and the client always knows which kind it holds because
the URL it was opened with said so.

**`GET` changes nothing.** No cookie, no guest session, no `lastUsedAt`, nobody
bound to a participant. Safe to call twice, safe to call and abandon — which is
what lets a sheet say _"Join Lisbon, March?"_ before anybody agrees to it.
`src/modules/join/redeem.integration.test.ts` asserts each of those separately,
because the failure would be invisible: a preview that quietly spent the link
still looks like a working preview.

It also answers **anonymously**, on purpose. The link is the authority — the
rule the whole join flow rests on, stated in `src/modules/join/service.ts` — and
what comes back is what the web already shows any holder of one. Asking somebody
to sign in before telling them what they are being asked to join is a worse
trade than it looks: they would be making an account to read an invitation they
might decline.

A personal invitation, read by a signed-out caller:

```json
{
  "groupId": "643b5dbd-…",
  "groupName": "Lisbon, March",
  "invitedBy": "Amelie",
  "participantName": "Bruno",
  "expiresAt": "2026-09-09T20:02:14.578Z",
  "icon": "plane",
  "iconColor": "coral",
  "memberCount": 3,
  "alreadyMember": false
}
```

Both routes answer the same nine fields. There is no envelope and no other key
— what a client cannot find here it will not find at runtime either:

| Field             | Type              | Null?   | Notes                                                                     |
| ----------------- | ----------------- | ------- | ------------------------------------------------------------------------- |
| `groupId`         | string (UUID)     | never   | Bare UUID, no prefix                                                      |
| `groupName`       | string            | never   |                                                                           |
| `icon`            | string            | **yes** | A slug from the list below, or `null` when nobody chose one               |
| `iconColor`       | string            | **yes** | An accent _name_ from the list below — never a hex value                  |
| `memberCount`     | number (integer)  | never   | Participants not removed, including the reader if they are one            |
| `invitedBy`       | string            | **yes** | Who minted the link; `null` when that account is gone                     |
| `participantName` | string            | **yes** | The seat a personal invitation holds; always `null` for a group-wide link |
| `expiresAt`       | string (ISO 8601) | **yes** | `null` means the link never expires — the default over this API           |
| `alreadyMember`   | boolean           | never   | Whether the _caller_ is in the group; always `false` when signed out      |

`icon` is one of exactly fifteen slugs, and `iconColor` one of exactly five,
both from `src/modules/groups/icons.ts`, which is the single source of truth for
the picker, the tile and the Zod schemas alike:

```
icon       plane luggage house tent car cart coffee meal party gift
           music sport bike heart star
iconColor  coral emerald amber plum blue
```

Accents are **named rather than stored as colour values**, so the palette can be
retuned without rewriting rows — a client maps the name to its own colour. Note
that the database checks only the _shape_ of a slug (`^[a-z][a-z0-9-]{0,31}$`),
deliberately, so that adding an icon is not a migration; the write schemas
enforce membership. A client should therefore treat an unrecognised slug as "no
icon" rather than as an error. An empty string is never returned: both fields
are normalised to `null` on write.

**`POST` takes the link and needs an account** — 401 otherwise, checked before
the token is resolved, so a signed-out caller cannot use it to probe whether a
link is live. It answers `200` with two fields, neither ever null:

```json
{
  "groupId": "643b5dbd-…",
  "participantId": "aaeeacb3-…"
}
```

`participantId` is the seat the caller now holds — the one they claimed, the one
the invitation named, or the one just created for them.

It is **idempotent**: an account already in the group gets the same body from the
same call rather than a conflict, so a double tap is not a failure. No new seat
is created the second time.

`POST /api/join/g/:token` accepts an optional body carrying the fork the web
offers on `/join/start`:

| Field           | Effect                                             |
| --------------- | -------------------------------------------------- |
| `participantId` | claim that unclaimed seat, keeping its history     |
| `displayName`   | join as somebody new under this name               |
| _(omitted)_     | join as somebody new under the name on the account |

`POST /api/join/:token` takes no body — the token names the seat.

#### The group has no claimable-member list yet

`GET /api/join/g/:token` does **not** return the names a joiner could claim, so
without a `participantId` the joiner always becomes a **new** participant. In a
group whose members were all typed in before anybody signed up — which is the
ordinary way a group is built — that strands their existing expenses on the
namesake they were supposed to become.

The fork is already there in `POST`, so a client that knows a `participantId` by
some other route can claim correctly today. What is missing is the list to
choose from. The web gets it from `listClaimableMembers` in
`src/modules/join/service.ts` (unclaimed, not removed, with their balances), and
exposing it here would be an additive `claimableMembers` array on the `GET` —
absent for personal invitations, where the seat is already decided.

Redeeming needs no **verified email**: verification is enforced at sign-in
(`signInWithPassword` refuses an unverified account when SMTP is configured), so
anything holding a session has already cleared it.

Both paths are rate-limited by client IP under the same buckets the web uses —
`joinRedeem` for the group link (40 per 10 minutes), `guestRedeem` for
invitations (20 per 10 minutes) — because an opaque token reachable
unauthenticated is a guessing surface the minting routes are not. The limiter
runs _before_ the token is resolved, so a burst against a dead link is limited
too, and the 429 carries `Retry-After` in seconds.

#### What comes back when it will not open

Refusals carry a sentence **and** a stable `code`:

```json
{
  "error": "This link has expired. Ask somebody in the group for a fresh one.",
  "code": "expired"
}
```

Unlike the rest of this API, that sentence is **translated** into the caller's
language, negotiated from the locale cookie or `Accept-Language`. These are the
only responses here a reader sees rather than a developer — the app puts them
straight into the sheet — so the rule in `src/lib/server-errors.ts` about the
mobile API answering in English does not reach them. The `code` is what a client
should branch on, and what lets the app show its own strings later.

These seven codes are the whole vocabulary — `src/app/api/join/refusals.ts` can
emit nothing else:

| `code`         | HTTP | When                                                                                                    | Routes                 |
| -------------- | ---- | ------------------------------------------------------------------------------------------------------- | ---------------------- |
| `invalid`      | 404  | Malformed token, one nobody minted, or one whose group was **deleted** (its links cascade away with it) | both, `GET` and `POST` |
| `expired`      | 410  | Past its `expiresAt`                                                                                    | both, `GET` and `POST` |
| `revoked`      | 410  | Revoked, replaced by a newer link, group **archived**, or the invitation's participant was **removed**  | both, `GET` and `POST` |
| `taken`        | 409  | The seat is held by another account — see below                                                         | **`POST` only**        |
| `authRequired` | 401  | No session. Answered before the token is read, so it never spends one                                   | **`POST` only**        |
| `rateLimited`  | 429  | Bucket exhausted; carries `Retry-After` in seconds                                                      | both, `GET` and `POST` |
| `unavailable`  | 500  | A fault on this side; logged in full, reported anonymously                                              | both, `GET` and `POST` |

The split a client needs: **404 and 410 mean the link is dead** and only a new
one helps; **409** means this account cannot have that particular seat, but the
link is fine; **401** means sign in and retry the same link; **429 and 500** mean
try again.

**`taken` is the one to route back rather than out.** It is what a client gets
when the seat it asked for was claimed between reading the link and taking it —
the race one link in a group chat makes reachable — and the link itself is still
good, so the right response is to send the reader back to pick another name, not
to a dead-link screen. It arrives in two situations, distinguished by the
sentence rather than the code:

- `POST /api/join/g/:token` with a `participantId` somebody else got to first.
  Without a `participantId` this cannot happen: a brand-new seat races with
  nobody.
- `POST /api/join/:token` for an invitation another account already redeemed —
  the link was minted for somebody else.

Two other rows are deliberate rather than incidental. An **archived group** reads
as a revoked link because saying otherwise would confirm the group exists,
matching `resolveJoinLink`; a client cannot tell the two apart, and should not
need to. And there is **no "already spent"** — neither link is single-use. Both
stay open until revoked or expired, redemption only stamps `lastUsedAt`, and a
personal invitation mints a fresh 30-day guest session on the web every time it
is opened.

The browser routes are unchanged and still work as they always did: `GET
/join/<token>` mints a guest session and answers `303` to `/invite`, `GET
/join/g/<token>` sets the join cookie and answers `303` to `/join/start`, and
failures land on `/join/error?reason=…`.

### Expiry and revocation

Both links are **reusable** until they lapse: redemption records `lastUsedAt`
and never spends the token. A per-person link mints a fresh 30-day guest
session every time it is opened.

- `expiresInDays` is 1–365 on both mint endpoints. **Omitting it means never**
  over this API, whereas the web's own picker defaults to a week — a client
  that wants the web's behaviour has to say `7`.
- `DELETE` on either endpoint revokes immediately, and revocation is checked on
  every resolution, so it also ends joins already in flight.
- A per-person link also dies when its participant is removed from the group.
- A group has **one** live join link: minting a second revokes the first in the
  same transaction, so the previously shared URL stops working.

### Universal Links

`/.well-known/apple-app-site-association` claims exactly these two shapes for
the iOS app, and excludes `/join/start` and `/join/error` — both are single
segments under `/join` that the `/join/*` claim would otherwise swallow, and
both are browser-only screens. The document is
`src/lib/apple-app-site-association.ts`, served through a rewrite because
Next's router skips dot-prefixed directories under `app/`; the claim is held to
the real URL builders by `src/lib/apple-app-site-association.test.ts`, since a
claim that drifts away from what is minted reports nothing anywhere.

## API keys

A key is what you give a piece of software instead of your account. It is
minted on **Settings → Security**, shown once, and sent as an ordinary bearer
header:

```
Authorization: Bearer blc_kZ8s…
```

Everything else about the request is unchanged: same paths, same JSON, same
statuses. A key authenticates _as its owner_ and can never do more than they
could — it only ever does less.

### What a key looks like

`blc_` followed by 43 characters of base64url — 32 random bytes, like every
other opaque token in Balancia. Only its SHA-256 hash is stored, so a database
dump yields a list of keys and no way to use one, and the value cannot be shown
again after the sheet that minted it.

The prefix is the one thing that is different from a session or a join token,
which are both bare base64url and indistinguishable from each other. A key is
pasted into other people's software — a crontab, a Shortcut, a `.env` file that
ends up in a repository — so it has to be greppable in a log and recognisable
to a secret scanner **before** it leaks rather than after. `blc_` plus the
following eight characters is also what the settings list shows, which is
enough to match a row against a key found in a script without revealing either.

### Scope, and the group pin

| Choice        | Effect                                                              |
| ------------- | ------------------------------------------------------------------- |
| `read`        | `GET` only. A `POST`, `PATCH`, `PUT` or `DELETE` is 403.            |
| `write`       | Reads and writes.                                                   |
| _(no group)_  | Every group the owner is in.                                        |
| _(one group)_ | That group only. Any other group id is 404, as if it did not exist. |

Two axes and no more. Anything finer would be a second permission system beside
the group roles in `src/lib/security/authorization.ts`, and a key cannot widen
those in any case: what it may do is the intersection of its scope with what
its owner could already do.

The pin is spent in `authorizeGroup`, beside the identical rule that keeps a
guest to one group — before any record is fetched, so a pinned key cannot be
used to discover which group ids exist. A pinned key on a route that names _no_
group (`GET /api/groups`, the notification inbox) is refused rather than
silently widened, because there would be nothing to check the pin against.

**`/api/rates` and `/api/parse` are the exception**, and are open to a pinned
key. Neither names a group and neither reads a row: a published reference rate
is nobody's data, and a parse is a regular expression over a sentence the
caller supplied. There is nothing for a pin to widen to, and the pair is
exactly what a share-sheet Shortcut reaches for on its way to writing an
entry — refusing them would leave a pinned key able to file an expense and
unable to work out what the sentence said or what the rate was.

### What no key may reach, at any scope

`src/modules/api-tokens/scope.ts` names every route under `src/app/api/` and
says whether a key may authenticate there. It is an **allowlist**: a route
added later is refused until somebody writes it in, and a unit test walks the
directory and fails the build while the table and the filesystem disagree.

| Refused                          | Why                                                                 |
| -------------------------------- | ------------------------------------------------------------------- |
| `/api/auth/*`                    | Signing in, registering, passkeys, Apple. The account's front door. |
| `/api/profile/*`                 | Name, address, avatar, payout details. The account itself.          |
| `/api/push/*`                    | Somebody's phones. Not a script's business.                         |
| `/api/join/*`, `…/join-link`     | Handing out a standing way into a group.                            |
| `/api/groups/:id/participants/*` | Who is in a group, and their invitations.                           |
| `DELETE /api/groups/:id`         | Taking the group and everybody's history with it.                   |
| `GET /api/groups/:id/export`     | The whole financial history in one request — see below.             |

The first six are the account and the door: a key is a narrower thing than the
account that minted it, so it must not be able to reach back and change who can
get in — to the account or to a group.

**Export is withheld for a different reason**, and it is the same sentence
guests are held to in `GUEST_PERMISSIONS`. It is not about secrecy: a `read`
key can already page through every expense in the group. It is that a bearer
credential may be forwarded, and a one-request download of a group's entire
financial history is a sharper tool in the wrong hands than the same data read
a page at a time. Read `/api/groups/:id/transactions` instead, which pages.

Routes a key may never reach do not read the `Authorization` header at all —
those handlers still resolve a cookie and are simply blind to it. That is a
stronger guarantee than a check they could stop performing: there is no branch
to get wrong. The one place the refusal is live rather than structural is a
method that shares a file with reachable ones, which today means
`DELETE /api/groups/:id`.

### Which credential answered

A request carries a key or a cookie, never both:

- **No `Authorization` header** — the cookie is resolved, exactly as before.
  Nothing about the existing API changes for a client that never sends one.
- **`Authorization: Bearer …`** — the key is the credential. If it is
  gibberish, revoked, or belongs to a disabled account, the request is **401**;
  it is never quietly downgraded to whatever session cookie happened to ride
  along on the same request. A bare `Bearer` with no value is the same 401.
- **Another scheme** (a `Basic` header some proxy added) is not a bearer
  attempt and is ignored.

A key is resolved **only in `src/app/api/**`**, by `apiActor` in
`src/app/api/mobile.ts`. `getCurrentActor()` knows nothing about keys, so no
Server Component and no Server Action can be reached with one — which is also
why minting and revoking are Server Actions: a key cannot mint a key, cannot
revoke one, and cannot list the others an account holds. There is no check
enforcing that; there is no path.

### Refusals

| Status | When                                                                       |
| ------ | -------------------------------------------------------------------------- |
| 401    | Unknown, revoked, malformed, or the owner's account is disabled.           |
| 403    | The key will not do: read-only on a write, pinned where no group is named. |
| 404    | A pinned key on another group — indistinguishable from "no such group".    |
| 429    | The key's own rate bucket: 600 requests per 10 minutes, keyed by key.      |

403 is the one refusal that is **not** answered 404. The 404 rule exists so
group ids cannot be probed, and nothing is being probed here: the caller
already holds the key and is being told a fact about the key itself, which they
need in order to mint a better one.

The rate limit is keyed by the key rather than by address, so a tablet and a
cron job on one home connection do not spend each other's allowance, and a key
used from a rotating address cannot escape its own.

### Expiry

There isn't any. A key works until it is revoked.

A default expiry sounds prudent and is not: a key that silently stops working
is a wall tablet that goes blank on a Tuesday and a cron job nobody notices
died, and the failure lands months after anyone remembers minting it.
`lastUsedAt` is the honest version of the same instinct — the settings list
prints it, "never used" is what a key that was pasted somewhere wrong says
about itself, and revoking is one tap.

### Managing keys

There is no HTTP route for this, on purpose (see _Which credential answered_).
Keys are minted and revoked on **Settings → Security**, beside the passkeys.
Revoking takes effect on the next request and cannot be undone: the secret was
never stored, so there is nothing to put back — mint another instead.

## CSRF

`src/proxy.ts` rejects cross-origin non-GET requests _when an `Origin` header
is present and does not match the host_. Native URL-loading stacks send no
`Origin`, so they pass; browsers send one, so the cookie still cannot be
ridden cross-site. Do not add an `Origin` header to a native client.
