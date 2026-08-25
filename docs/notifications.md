# Notifications

Balancia tells people when something happens to money they are part of. There
are two surfaces, and only one of them needs configuring:

- **In the app** — a bell in the header with an unread count, and
  `/notifications`. Works out of the box, always.
- **Push** — the same message on a phone or laptop with Balancia closed.
  Needs a VAPID key pair; see [environment.md](environment.md#push-notifications-optional).

## What raises one

| Event                                     | Who is told                                    |
| ----------------------------------------- | ---------------------------------------------- |
| An expense is added, edited or deleted    | Everyone who paid for it or owes a share of it |
| A payment is recorded, changed or deleted | The two people it is between                   |
| A recurring expense is generated          | Everyone in the generated split                |
| An import finishes                        | The person who started it                      |

Three rules apply to all of them:

1. **Nobody is told about their own action.** The actor is removed from the
   audience before anything is written.
2. **Only people the change touches.** Being in the group is not enough — a
   dinner you have no share of does not notify you. An edit notifies the people
   in the _old_ split as well as the new one, so being dropped from a split is
   something you hear about.
3. **Only accounts.** A guest is a link holder with nothing stored to reach
   them by, so a participant with no linked user is silently not a recipient.

Each person has four switches (expenses, payments, recurring, imports) and can
quieten a group — either **muted**, which lasts until it is undone, or
**snoozed for 24 hours**, which wears off on its own. Both are the same row in
`notification_group_mutes`, and `snoozed_until` is the whole of the difference:
null is a mute, a timestamp is a snooze, and a timestamp that has passed
suppresses nothing (nothing sweeps them; the row is simply spent).

Switches and quiet alike suppress the notification at the point it would be
written, rather than hiding one that already exists — so a quietened group
leaves nothing behind to read later, and nothing accumulates for the moment a
snooze lifts. The settings screen lists only the mutes: a decision that undoes
itself tomorrow morning does not belong beside a switch.

## The inbox

`/notifications` groups what it has rather than listing it flat.

- **Day sections.** Today, Yesterday, Earlier, decided on the server in the
  reader's own time zone (`day.ts`) and sent down with each row — computed in
  the browser it would be read off a second clock, and a list drawn at ten past
  midnight would hydrate into different headings than the ones already on
  screen.
- **Filters.** All / Unread / Reminders, with counts. A quietened group and a
  row swiped away drop out of every count, or the badge could not be cleared.
- **Group chips** print once per run of consecutive rows from one group. A
  reminder card ends the run.
- **Bursts.** Consecutive rows about one entity _by one person_ fold into
  "{actor} made {n} changes to {description}". One person, because the sentence
  names one — two people editing the same expense stay two rows.
- **Imports** sink to the foot of their day; two or more in a day become one
  expandable count. They are receipts for something the reader started, not
  news.
- **Reminders** are cards with the sender's own words and two actions, Settle
  up and Copy link.
- **The archive** is the read half older than 30 days, behind a footer on the
  All filter. Unread rows never archive, however old: nobody has looked at
  them. It is a separate query, so an old read row cannot spend one of the
  fifty the inbox asks for.

Swiping a row left dismisses it **for as long as the list is on screen**. There
is no column behind it — a notification is a record of something that happened,
and the reader is clearing their view rather than editing history — so it comes
back on the next load. Every row is a real button, the swipe has a Dismiss
button beside it for anyone who is not holding a phone, and unread state is in
the accessible name as well as in the dot.

The wording of a row comes from `renderNotification` like everything else, but
in two halves: `sentence` (actor, verb, object) and `amount`, so the inbox can
right-align the figures into a column that can be read down. `body` is the two
joined, and that is what a push message sends — one wording, two shapes.

## How it is delivered

```
   change commits                         worker
        │                                    │
        ├─ notifications row ────────────────┼──► claim (pushed_at)
        │  (same transaction)                │        │
        │                                    │        ├─► encrypt (RFC 8291)
        └─ enqueue notifications.deliver ────┘        └─► POST to push service
                    │
           (missed?) └──► notifications.sweep, every 5 minutes
```

The row is written **inside the transaction that made the change**, exactly
like an activity event. The inbox therefore cannot announce an expense that was
rolled back.

Push is sent **after** that transaction commits, from the worker, because it is
a network call to a third party and must not run inside a transaction. If the
enqueue fails — the queue is down, the process died — the sweep finds the row
by its null `pushed_at` and delivers it. Both paths claim a row with the same
`UPDATE … WHERE pushed_at IS NULL`, so a notification is pushed at most once no
matter how many runs race for it. Anything older than an hour is stamped
without being sent: it is still in the inbox, but a card about this morning's
coffee arriving tonight is noise.

Delivery runs in the worker. On a single-container install set
`RUN_WORKER_IN_WEB=true`, or nothing is pushed.

## Privacy

A push message cannot be delivered by your own server. Browsers only accept
push from the service their vendor runs — Google's for Chrome, Mozilla's for
Firefox, Apple's for Safari — so enabling push means those services see that a
message went to a given device, and when.

They do not see _what_. Every payload is encrypted end to end with the
subscription's own key under RFC 8291, using a fresh ephemeral key and salt per
message; the push service relays ciphertext. The VAPID token identifies this
instance to the push service and carries three claims — the service's own
origin, an expiry and the operator's contact address — and nothing about the
recipient. The endpoint is never logged.

Leave the keys unset and Balancia contacts nobody; people still get every
notification inside the app.

## Implementation

- `src/lib/push/encrypt.ts` — RFC 8291 payload encryption over the `aes128gcm`
  content coding of RFC 8188.
- `src/lib/push/vapid.ts` — RFC 8292 ES256 tokens, cached per push service.
- `src/lib/push/send.ts` — one HTTP request, and the four answers that change
  what the caller does next (sent / expired / retry / failed).
- `src/modules/notifications/` — audience rules (`events.ts`), writes and
  reads (`service.ts`), the shared renderer (`render.ts`), day bucketing
  (`day.ts`) and delivery (`delivery.ts`).
- `src/components/notifications/` — the inbox. `grouping.ts` holds the
  sectioning, chip dedupe, burst folding and import digesting as pure
  functions over the rows the server rendered, which is why all of it is
  tested as arithmetic rather than by driving a list with a pointer.

The renderer is shared deliberately: the card on a lock screen and the row in
the inbox are produced by the same function, so they cannot word the same event
differently. Payloads store facts, never sentences, so a notification is
written in the reader's language at the moment it is read — or, for push, in
the recipient's language rather than the actor's.

A subscription the push service reports as gone (404/410) is deleted rather
than retried; one that keeps failing temporarily is retired after ten
consecutive failures.
