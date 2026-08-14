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
mute a group outright. Both suppress the notification at the point it would be
written, rather than hiding one that already exists — a muted group leaves
nothing behind to read later.

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
  reads (`service.ts`), the shared renderer (`render.ts`) and delivery
  (`delivery.ts`).

The renderer is shared deliberately: the card on a lock screen and the row in
the inbox are produced by the same function, so they cannot word the same event
differently. Payloads store facts, never sentences, so a notification is
written in the reader's language at the moment it is read — or, for push, in
the recipient's language rather than the actor's.

A subscription the push service reports as gone (404/410) is deleted rather
than retried; one that keeps failing temporarily is retired after ten
consecutive failures.
