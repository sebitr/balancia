# Shortcuts, and anything else that speaks HTTP

Say "twenty-four fifty at the Coop" to your phone and have it land in the flat's
expenses, without opening Balancia.

This guide is about doing that with Apple's Shortcuts app, because that is where
most people meet it — but nothing here is Apple's. It is three HTTP calls, and a
crontab, a Home Assistant automation, an n8n flow or a shell script makes them
the same way.

There is **no app to install for any of this**, on either side. Balancia needs no
plugin and you need no Xcode: an API key and a URL are the whole integration
surface.

## What you need

Two things, and both of them already exist:

1. **An API key.** Settings → Security → API keys. See
   [the mobile API reference](mobile-api.md#api-keys) for what a key is and what
   it may reach; the short version is below.
2. **The address of your instance.** `https://balancia.app`, or your own.

### Which key to mint

For a phone, mint a **`write` key pinned to one group**, and mint a second one
for the second group rather than widening the first.

That is not caution for its own sake. A key on a phone ends up in a shortcut
somebody else can run while the phone is unlocked, and pinning is the difference
between "can file an expense in the flat" and "can file an expense anywhere, and
read every group I am in". A pinned key answers **404** for any other group —
the same answer it would give for a group that does not exist — so it cannot
even be used to find out what else you are part of.

Mint a **`read`** key for anything that only looks: a wall tablet showing what
the flat owes, a script that mirrors the ledger into a spreadsheet, a status
line on a dashboard.

The key is shown **once**, on the sheet that mints it. Paste it somewhere before
you dismiss that sheet; the server keeps only a hash and cannot show it again.
If you lose it, revoke it and mint another — that costs nothing and is the
supported way round.

## The three calls

Every request carries the key as an ordinary bearer header:

```
Authorization: Bearer blc_kZ8s…
Content-Type: application/json
```

### 1. What did they say?

```http
POST /api/parse
{ "text": "24.50 francs Coop", "fallbackCurrency": "CHF" }
```

```json
{
  "amountText": "24.50",
  "currency": "CHF",
  "description": "Coop",
  "amountMinor": "2450"
}
```

This is the same parser the dictate button in the app uses. It knows the
currency words people actually say out loud rather than the codes — francs,
quid, balles — and it takes the amount and the currency **out** of the
description, so `description` is what is left to write on the entry.

`fallbackCurrency` is what the figure is in when the sentence names nothing. It
is optional, and leaving it out is the honest thing to do when you have not
chosen a group yet.

**`amountMinor` is the field to send on.** Every write in this API takes minor
units — `"2450"` for CHF 24.50 — because that is what the money domain stores,
and multiplying by a hundred yourself is wrong for the yen (no decimals), wrong
for the Kuwaiti dinar (three), and wrong in a way that will not show up until
somebody in your group spends in one of them. It is `null` when there is nothing
to convert honestly: no amount in the sentence, no currency to convert against,
or more decimals than the currency has. In every one of those cases `amountText`
still holds what was heard.

There is **no error case here.** Words with no amount in them come back as a
description with `amountText` empty, which is the parser saying "I got you this
far" rather than refusing. A shortcut that treats a 200 with no amount as a
failure is throwing away the half that worked.

### 2. Who am I in this group?

```http
GET /api/groups/{groupId}
```

You need two things out of the answer, and a third is worth having:

| Field               | What it is for                                        |
| ------------------- | ----------------------------------------------------- |
| `participantId`     | **You**, in this group. The payer of the new expense. |
| `participants[].id` | Everyone the expense is split between.                |
| `group.timezone`    | Which day "today" is. See below.                      |

A pinned key already names its group, so this is the call where a shortcut
learns the ids it needs. It is also the call to skip if you would rather paste
the two ids into the shortcut once and save a round trip — they do not change,
and a shortcut that reads them every run is trading a little speed for never
going stale when somebody joins the group.

### 3. Write it

```http
POST /api/groups/{groupId}/expenses
Idempotency-Key: 6a1e6f2c-6f1e-4a2e-9e3a-0d2b8f9c1a44

{
  "description": "Coop",
  "amount": "2450",
  "currency": "CHF",
  "expenseDate": "2026-09-10",
  "payers": [{ "participantId": "…you…", "amount": "2450" }],
  "splitMethod": "equal",
  "splitEntries": [
    { "participantId": "…you…" },
    { "participantId": "…Jonas…" },
    { "participantId": "…Anna…" }
  ]
}
```

`201` and `{ "expenseId": "…" }`, and it is in the group.

Three things about that body:

- **`payers` is a list**, because one bill can have several. One entry naming
  you, for the whole amount, is the ordinary case; across several, the amounts
  must add up to `amount`.
- **`splitEntries` names everybody it is split _between_**, which for an equal
  split is usually every participant — including you. Leave somebody out and the
  bill is split between the rest, which is a feature ("Anna wasn't there") and a
  bug if you meant everyone.
- **`expenseDate` is a calendar date, `YYYY-MM-DD`, with no timezone on it.**
  Use the group's own `timezone` from step 2 to work out which day it is. A
  shortcut run at 00:30 in Lisbon that files an expense against yesterday
  because your phone is set to UTC is the sort of thing nobody notices for a
  month.

### Sending it twice by accident

Send an **`Idempotency-Key`** — a UUID, minted per entry, reused on every retry
of that same entry. A phone that loses signal mid-request cannot tell "it never
arrived" from "it arrived and the reply got lost", and without a key the retry
writes a second expense and the balances are quietly wrong. With one, the replay
answers `201` with the id the first call created.

Shortcuts has no UUID action, but _Get Contents of URL_ will happily send a key
built out of the current date and a random number — anything stable across the
retries of one entry does the job.

## Building it in Shortcuts

The whole thing is six actions:

| #   | Action                   | What it does                                                      |
| --- | ------------------------ | ----------------------------------------------------------------- |
| 1   | **Dictate Text**         | Or _Ask for Input_, or _Shortcut Input_ from the share sheet.     |
| 2   | **Text**                 | The JSON body for `/api/parse`, with the dictated text inside it. |
| 3   | **Get Contents of URL**  | `POST` to `/api/parse`, headers as above.                         |
| 4   | **Get Dictionary Value** | `amountMinor`, `currency` and `description` out of the answer.    |
| 5   | **Text**                 | The expense body, with those three and your two ids.              |
| 6   | **Get Contents of URL**  | `POST` to `/api/groups/{id}/expenses`.                            |

Add a **Show Notification** on the end so the phone says what it filed. A
shortcut that writes to a ledger and says nothing is a shortcut nobody trusts
twice.

Put the key in a **Text action at the top** and reference it, rather than typing
it into three header fields — you will want to change it one day, and a key
pasted in three places gets changed in two.

### Where to put it once it works

- **The Action Button** (iPhone 15 Pro and later) — Settings → Action Button →
  Shortcut. This is the till case: bag in one hand, long-press, speak, done.
- **The Lock Screen or Home Screen**, as a widget.
- **An NFC sticker**, via a Personal Automation: tap the phone to the fridge and
  the flat's shortcut runs. The flatmate who never installed anything can use it
  too.
- **A Personal Automation on arriving somewhere**, on leaving a Wi-Fi network,
  or when CarPlay disconnects.
- **The share sheet**, by turning on _Use as Quick Action → Share Sheet_ and
  taking `Shortcut Input` as the text in step 1. Forward a message that says
  "dinner was 84.20" and it becomes a draft.

## Five that are worth building

| Shortcut             | The three calls do this                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| **Add to the flat**  | Dictate → parse → write. The one everything else is a variation of.                                      |
| **Another round**    | Read the last expense from `GET …/expenses?limit=1` and post it again, same amount and split.            |
| **Where do I stand** | `GET /api/groups` and speak the net position. A `read` key is enough.                                    |
| **Who owes me**      | `GET …/reminders`, which also answers with `payWith` — your own ways of being paid this particular debt. |
| **Log the fuel**     | An automation on CarPlay disconnecting, with the amount asked for rather than dictated.                  |

## Things that will bite

**The rate limit is per key, not per address.** 600 requests in ten minutes. A
tablet and a cron job on one home connection do not spend each other's
allowance, and a shortcut that loops will find its own ceiling rather than
somebody else's. A `429` carries `Retry-After`; obey it.

**A `read` key on a write is 403, not 404.** That is deliberate: you already
hold the key, nothing is being probed, and you need to know it is the key rather
than the group so you can mint a better one.

**A pinned key cannot call `GET /api/groups`** — that route names no group, so
there is nothing to check the pin against, and it is refused rather than
silently widened. `/api/parse` and `/api/rates` are the two exceptions and are
open to a pinned key: neither reads a row, and refusing them would leave a key
able to file an expense and unable to work out what the sentence said.

**No key can reach the account or the door.** Signing in, the profile, push
devices, invitations, join links, who is in a group, deleting a group, and the
bulk export are all refused at any scope. The full table is in
[the API reference](mobile-api.md#what-no-key-may-reach-at-any-scope).

**Keys do not expire.** They work until revoked. The list on Settings → Security
prints when each was last used, which is what makes a forgotten one visible —
check it now and then, and revoke what you no longer recognise.

## What this is not

This is not an App Intent. A shortcut built this way cannot be offered by Siri
on its own, cannot appear in Spotlight, and cannot resolve "which group?" by
asking. It runs when something runs it.

That is a real ceiling, and the native surface is the better long-term answer.
It is not a reason to wait: the recipe above works today, on any instance, from
any device that can make an HTTP request, and it is the cheapest way to find out
which of these you actually reach for.

**Signed `.shortcut` files are not shipped yet.** Importing an unsigned shortcut
file is a fiddly path on modern iOS, and signing one needs a Mac and a device to
prove the import on. Publishing files nobody has confirmed will open would be
worse than publishing none, so what is here is the recipe. If you build one and
it works, a link to it is a welcome contribution.

## Is this still true?

`tests/integration/shortcut-recipe.test.ts` runs the three calls above against a
real database and reads the entry back out. Every field this page tells you to
pluck out of a response is plucked out of a real one there, so a rename that
would break a shortcut you built six months ago fails the build first.
