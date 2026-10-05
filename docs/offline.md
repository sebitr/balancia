# Offline expense entry

Balancia records expenses with no network and sends them when there is one.
This matters because the trip is the case: a group splitting a fortnight
abroad is a group whose phones spend that fortnight without data, and an
expense you cannot enter at the table is an expense somebody reconstructs from
memory three days later, or does not enter at all.

What follows is what works offline, what does not, and why the difference
falls where it does.

## What works

**Adding an expense or an income.** The full form — amount, currency,
description, category, who paid, how it splits — from the group's own people
and categories. It is dated today in the group's timezone, worked out from this
device's clock when the form opens, which is the same day the online form
would have picked. Saving keeps the entry on the device and says so, in those
words rather than "Expense added": the group's balances have not moved yet and
the confirmation should not claim they have.

**Two ways in.** With the app open, the bottom bar's **+** opens the form
directly instead of navigating to it. Cold-starting with no network lands on
the offline screen, which lists the groups this device can add to.

Both rest on the service worker, which the first screen of the app a device
opens registers — a group screen, a guest's included, or any signed-in one;
not the homepage, and not a join link. Its precache holds every build chunk
under the size line in `serwist.config.mjs`, and that is why the drawer can
fetch its form only when it opens rather than with every group screen: the
form is the largest thing in the app, and the device already holds it. The
offline screen carries the form's strings in every language, read at build
time, because it cannot know which one it will be opened in.

**Sending, on its own.** The queue drains when the app is opened, when the
browser reports a network, and when the tab becomes visible again. The last of
those is the one that usually fires: a phone that has been in a pocket is a
frozen tab, and it wakes up somewhere with signal rather than being told it has
arrived.

**Seeing what is waiting.** A line above the group says how many of your
entries have not reached the server. Tapping it lists them. They are
deliberately not shown in the group's own list or folded into its balances,
because they are not in the group yet — a total that included them would be a
number nobody else can see.

## What does not, and why

**Editing an entry that already exists.** This is the one real conflict in the
problem, and it is avoided rather than solved. Two people offline create two
different expenses; they do not edit the same one. But a phone that has been
away for a day holds a copy of a row that may since have been changed or
deleted by somebody else, and replaying it would silently overwrite them.

**Recording a repayment.** A repayment is priced from who owes whom, which is a
running total across everybody's entries. A device can keep a copy of that
total, but not a true one — and a settlement offered against this morning's
figure is a wrong number rather than an old one.

**Reading balances and history.** For the same reason. The offline screen says
plainly that they are unavailable rather than showing a stale figure with no
mark on it.

**Receipt scanning.** The server-side reader is a network call. The on-device
one would work, but its models are tens of megabytes fetched on first use, and
there is nothing to fetch them with.

**A group whose add screen has never been opened on this device.** The snapshot
the offline form renders from is written when that screen loads with a server
behind it. Open a group once before travelling and it works from then on.

## Writing an expense exactly once

The queue's only real risk is a double write. A device that loses its
connection mid-request cannot tell "never arrived" from "arrived, and the
answer was lost on the way back", so it sends again — and a second send that
writes a second expense leaves the group wrong by the price of a dinner, with
nothing on screen to explain it.

So every save carries an **idempotency key**: a UUID minted by the form before
it decides which way to send, travelling as the `Idempotency-Key` header on
`POST /api/groups/:groupId/expenses`. The server records it in
`entry_client_keys` — a group, a key unique within it, and the row that key
produced — in the same transaction as the expense itself. A replay finds the
key, answers 201 with the id it already made, and writes nothing — the same
answer as the first call, which is all a queue needs in order to stop.

The table's shape is `imported_fingerprints`, which solves the same problem for
re-run imports. What differs is where the value comes from, and the difference
is the point. An import fingerprint is a hash of what a row _means_, because
two exports of one transaction have nothing else in common. Here the client is
the same device that queued the entry, so it mints a random key and keeps it
with the payload — which is the only way two genuinely identical entries can
both land. Four people splitting the same €3 coffee twice in one afternoon is
two expenses, and a content hash would silently eat the second. An import can
count the copies of a line within one file; a queue sends entries one at a
time, with nothing to count them against.

The key is carried on the online path too, not only from the queue. That is
where it earns most of its keep: a save over a live connection can still lose
its answer, the form cannot tell that from a request that never left, and
carrying the key means it does not have to — it queues under the key the
attempt already used, and a write that did land adds nothing when it replays.

A key is spent for good once used, deletion included. A replay arriving after
somebody removed the entry hands back that id and leaves the deletion standing:
the person who removed it could see what it was, and a network retry is not a
reason to overrule them.

**Repayments carry a key too**, though they are never queued. Without a queue
to hold the key between attempts, the form holds it instead: one key from the
first press of **Record payment** until a save lands, so pressing again after
an answer that never came back replays that attempt rather than paying the debt
a second time. `POST /api/groups/:groupId/settlements` takes the same header on
the same terms. Changing an entry between an expense and a repayment is covered
as well: it writes the new row and removes the old one in a single transaction
under the form's key, so a second send of the same change answers with the row
the first one made.

## When the server says no

Not every refusal is worth retrying, and the ones that are must never be
mistaken for the ones that are not.

| What came back                      | What happens                                              |
| ----------------------------------- | --------------------------------------------------------- |
| 201 — written, or already written   | The server has it exactly once. The device's copy is gone |
| No answer at all                    | Kept, retried — this is the ordinary case                 |
| 401, session expired                | Kept, retried once its author signs back in               |
| 429, or a 5xx                       | Kept, retried with a backoff capped at two minutes        |
| 404 — group gone, or access lost    | Held back and shown to the reader                         |
| 409 — the group was archived        | Held back and shown to the reader, as archived            |
| 422 — refused, e.g. a removed payer | Held back and shown to the reader                         |

A queued entry is never dropped except by the server accepting it, by the
person who typed it discarding it, or by a sign-out on the device — which says
how many it is about to delete before anybody confirms (see below). The 401 row
is the one worth reading twice: a phone that has been offline for hours very
often has a session that timed out, so that is the _likeliest_ greeting a
reconnecting flush gets, and treating it as a refusal would throw away an
evening at the moment its owner signs back in.

An entry that has been held back is listed with the reason and a **Discard**
button. Nothing else in the group removes one.

## Whose entries go

The queue belongs to the device, and a device can change hands between an
entry being typed and a network turning up: a session lapses, somebody else
signs in. A flush sends with whatever session cookie the browser holds, so
without a check the second person would post the first one's dinner as their
own — and if they are in the same group, the server would take it.

So every queued entry and every draft is stamped with who typed it, and only
that person's are sent, listed or offered back:

- **An account** is stamped with its user id, and its entries go from any
  group's screen, in the order they were typed.
- **A guest** has no account, only a seat: one participant row in the group
  their link opened. Their entries are stamped with that seat and go from that
  group's screen. A guest who then signs up keeps the same seat — the
  participant row is linked to the new account — so what they typed as a guest
  still goes.
- **Somebody else's** entries are neither sent nor shown. They wait, untouched,
  for their author, or for a sign-out to clear them.

Knowing who is signed in costs no request: the group layout has already
resolved the actor to authorize the page, and hands it down. The offline screen
has no server behind it, so it reads who the group's form was last opened for
from that group's snapshot, which records the account alongside it.

**Entries from before this existed** had no author. The database's upgrade to
version 4 adopts each one, once, as the seat named by the snapshot of its
group: the same form wrote both, so that seat is whoever was typing. It is done
inside the upgrade rather than at flush time because by then the snapshot may
have been rewritten by somebody else; inside the upgrade, nothing on the new
version has written anything yet. An entry whose group has no snapshot cannot
be placed, and is held rather than sent as whoever happens to be signed in; no
group lists it, and the next sign-out counts it in its warning and clears it.

## Signing out

A phone is often somebody else's next, and signing out takes this device's
copy of the person off it — from every sign-out: the settings hub, the Account
screen, and deleting the account.

1. **The page cache is deleted.** The service worker keeps every screen it
   serves in `balancia-pages` so that a dropped signal does not blank the one
   on show. Those are server-rendered pages — balances, names, amounts — and
   the next person could otherwise read them with the radio off, or after the
   five seconds the worker waits for a server.
2. **The offline database is deleted.** Snapshots, the outbox, drafts and any
   share waiting to be filed.
3. **Push stops on this browser.** The server forgets its subscription and
   the browser unsubscribes, so the account's notifications stop reaching a
   device somebody else may now be holding. Before the session ends, because
   the server's half needs it. [Notifications](notifications.md#a-device-that-changes-hands)
   has the detail.
4. **The session ends**, through `DELETE /api/auth/session`, whose answer
   carries `Clear-Site-Data: "cache"` for what the browser holds outside the
   app's reach, in its own HTTP cache. A Server Action cannot set a response
   header, which is why that route is called first; the sign-out action then
   runs as before and redirects. Browsers act on the header only over HTTPS,
   and `"cache"` does not cover the worker's Cache Storage, which the
   specification files under `"storage"` — which is why steps 1 and 2 are
   done by the page rather than left to the header.

None of the first four can hold a sign-out up: a missing service worker, a
store the browser refuses, a request that fails — each costs what that step was
for, and the person is still signed out.

Before anybody confirms, the sheet counts what is still in the outbox and says
that signing out deletes it, while **Stay signed in** is still there to press. Those
entries exist nowhere else.

The build output, icons and the optional model files stay: they are the same
bytes for everybody, and the models are tens of megabytes to fetch again.

**Not `Clear-Site-Data: "storage"`.** It would do steps 1 and 2 in one line,
and it would also unregister the service worker — taking the offline screen
with it, for whoever picks the device up next, until the app is next opened
with a network. It would end the push subscription too, but without telling
the server, which step 3 does. Deleting what actually holds the person is
exact; the directive is not.

## Sharing into Balancia

Not an offline feature, and documented here anyway: it is the same database,
the same service worker and the same draft the drawer restores, and splitting
those across two pages is how the second one goes stale.

Balancia registers as a **share target** for images, PDFs and text. Photograph
a receipt and share it, forward the booking confirmation, or forward the
message that says what dinner cost, and Balancia appears in the share sheet.
Choosing it opens the entry form for a group you pick, with what you shared
already in it.

What happens in between:

1. The manifest declares `share_target` with `method: POST` and
   `multipart/form-data`, which is the only shape that can carry a file.
2. The service worker intercepts that POST — `src/app/sw.ts`, registered
   **before** Serwist's own fetch listener, which would otherwise send it to
   the network as an uncached mutation. It puts the form in the
   `shared-payloads` store and answers **303 to `/share`**.
3. `/share` reads the store, asks which group, writes that group's draft, and
   navigates to `…/expenses/new#draft=1`.

Three decisions worth knowing:

**The redirect is not a detail.** Rendering a page in response to the POST
would leave a form submission in the history for the back button to
re-submit. A 303 to a GET leaves somebody on a screen they can reload and
leave.

**The share never reaches the server.** The photograph and the words sit in
IndexedDB until a group is chosen; only then is a receipt uploaded, to that
group. A shared receipt is no more exposed than a half-written draft, and one
abandoned at the group picker goes stale after an hour rather than sitting
there.

**A bare URL is not a sentence.** Text is parsed by the same `heardEntry` the
dictate button uses, on the device — but a shared link is dropped rather than
parsed, because `…/product/12345` reads as a hundred and twenty-three francs
nobody spent, filed under a description of a web address. A share carrying only
a link opens an empty drawer, which is the honest answer.

**Not on iOS.** Safari implements no Web Share Target, for installed web apps
or otherwise, so this reaches Android and desktop Chromium. The native app's
share extension is the other half and is not in this repository.

## Where it lives

Four IndexedDB stores, in a database called `balancia-offline`:

- `group-snapshots` — per group, exactly the props the entry form is rendered
  with: people, categories, currency mode, timezone — and whose account it was
  taken for. No balances, no history, no expenses.
- `outbox` — queued entries, keyed by their idempotency key so the queue
  structurally cannot hold two records that would write the same expense, each
  stamped with who typed it.
- `entry-drafts` — one half-written entry per group, kept when the drawer is
  closed with something in it, expiring after a week, and offered back only to
  whoever was typing it.
- `shared-payloads` — what another app just shared, between the worker that
  caught the POST and the screen that reads it. One at a time, deleted as it is
  read, stale after an hour.

All four are on the device and are never sent anywhere except as the expense
they become. Signing out deletes the database, and so does clearing site data;
either one, while entries are queued, loses those entries — they exist nowhere
else until the server has them.

The code is in `src/lib/offline/`: `idb.ts` is the whole IndexedDB dependency,
`outbox.ts`, `snapshot.ts`, `drafts.ts` and `shared.ts` are the four stores,
`replay.ts` is the decision table above, `flush.ts` drains the queue,
`owner.ts` decides whose each record is, and `forget.ts` is what signing out
deletes.

## Notes for other clients

The queue is not a browser feature. `Idempotency-Key` is part of the mobile API
contract (see [the mobile API](mobile-api.md)), and any client with a queue of
its own should send one: a UUID per entry, fixed before the first attempt and
reused for every retry of that entry.

**Not the Background Sync API.** That is the textbook answer for this and is
unavailable in Safari — that is, on the iPhones this feature exists for. The
triggers described above work everywhere, which a queue that drained on Android
and quietly did not on iOS would not.
