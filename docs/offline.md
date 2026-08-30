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
and categories. Saving keeps the entry on the device and says so, in those
words rather than "Expense added": the group's balances have not moved yet and
the confirmation should not claim they have.

**Two ways in.** With the app open, the bottom bar's **+** opens the form
directly instead of navigating to it. Cold-starting with no network lands on
the offline screen, which lists the groups this device can add to.

**Sending, on its own.** The queue drains when the app is opened, when the
browser reports a network, and when the tab becomes visible again. The last of
those is the one that usually fires: a phone that has been in a pocket is a
frozen tab, and it wakes up somewhere with signal rather than being told it has
arrived.

**Seeing what is waiting.** A line above the group says how many entries have
not reached the server. Tapping it lists them. They are deliberately not shown
in the group's own list or folded into its balances, because they are not in
the group yet — a total that included them would be a number nobody else can
see.

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
two expenses, and a content hash would silently eat the second.

The key is carried on the online path too, not only from the queue. That is
where it earns most of its keep: a save over a live connection can still lose
its answer, the form cannot tell that from a request that never left, and
carrying the key means it does not have to — it queues under the key the
attempt already used, and a write that did land adds nothing when it replays.

A key is spent for good once used, deletion included. A replay arriving after
somebody removed the entry hands back that id and leaves the deletion standing:
the person who removed it could see what it was, and a network retry is not a
reason to overrule them.

## When the server says no

Not every refusal is worth retrying, and the ones that are must never be
mistaken for the ones that are not.

| What came back                      | What happens                                              |
| ----------------------------------- | --------------------------------------------------------- |
| 201 — written, or already written   | The server has it exactly once. The device's copy is gone |
| No answer at all                    | Kept, retried — this is the ordinary case                 |
| 401, session expired                | Kept, retried after signing in                            |
| 429, or a 5xx                       | Kept, retried with a backoff capped at two minutes        |
| 404 — group gone, or access lost    | Held back and shown to the reader                         |
| 422 — refused, e.g. a removed payer | Held back and shown to the reader                         |

A queued entry is never dropped except by the server accepting it or by the
person who typed it discarding it. The 401 row is the one worth reading twice:
a phone that has been offline for hours very often has a session that timed
out, so that is the _likeliest_ greeting a reconnecting flush gets, and
treating it as a refusal would throw away an evening at the moment its owner
signs back in.

An entry that has been held back is listed with the reason and a **Discard**
button. Nothing else removes one.

## Where it lives

Two IndexedDB stores, in a database called `balancia-offline`:

- `group-snapshots` — per group, exactly the props the entry form is rendered
  with: people, categories, currency mode, timezone. No balances, no history,
  no expenses.
- `outbox` — queued entries, keyed by their idempotency key so the queue
  structurally cannot hold two records that would write the same expense.

Both are on the device and are never sent anywhere except as the expense they
become. Clearing site data clears them, and clearing them while entries are
queued loses those entries — they exist nowhere else until the server has them.

The code is in `src/lib/offline/`: `idb.ts` is the whole IndexedDB dependency,
`outbox.ts` and `snapshot.ts` are the two stores, `replay.ts` is the decision
table above, and `flush.ts` drains the queue.

## Notes for other clients

The queue is not a browser feature. `Idempotency-Key` is part of the mobile API
contract (see [the mobile API](mobile-api.md)), and any client with a queue of
its own should send one: a UUID per entry, fixed before the first attempt and
reused for every retry of that entry.

**Not the Background Sync API.** That is the textbook answer for this and is
unavailable in Safari — that is, on the iPhones this feature exists for. The
triggers described above work everywhere, which a queue that drained on Android
and quietly did not on iOS would not.
