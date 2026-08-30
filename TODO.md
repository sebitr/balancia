# TODO

The living list of what is planned, in flight, and recently finished. Every
chat reads this before starting and updates it as work moves — see the
_Keeping the list_ section at the bottom for the rules.

One item per line. Keep the newest at the top of its section so two chats
appending at once conflict on different lines.

## Now

Started, on a branch, not yet merged.

- [ ] Settle up with a code the payee's own bank reads, beyond the two SEPA ones — `feat/payout-reach`
- [ ] Join preview: agree with the join about a removed member — `feat/join-redeem-api`

## Next

Agreed on, not started. Pick from the top.

- [ ] Use the whole window on a desktop, instead of a phone column with a bottom bar — `src/components/layout/app-shell.tsx`

## Someday

Worth doing, nobody has committed to it, safe to ignore for months.

<!-- - [ ] Item — pointer to the doc or file that explains it -->

## Done

Merged. Trim entries older than a couple of months; git history is the real
record.

- [x] 2026-08-26 Write down what the join routes actually answer — #245
- [x] 2026-08-26 Build the background translator without dragging React in — #244
- [x] 2026-08-26 Hold on to how somebody arrived once they stop being a guest — #243
- [x] 2026-08-26 Let the phone open a join link without spending it — #242
- [x] 2026-08-26 Install worktree dependencies after creation, not instead of it — #241
- [x] 2026-08-26 Point the sign-in tests at the copy that ships — #240

## Keeping the list

An item is one line, and it carries enough for somebody who was not in the
chat that wrote it:

```
- [ ] What changes, in the words a user would recognise — pointer
```

The pointer is a branch name once work starts, and otherwise the doc or file
that explains the item — `docs/mobile-api.md`, `src/lib/env.ts`. An item with
no pointer is a note to self, and nobody else can pick it up.

When you start something, move its line to **Now** and append the branch name.
The branch name is the part that matters: several chats work this repository at
once, in separate worktrees, and it is the only way to see that a thing is
already being done rather than doing it twice.

When the pull request merges, move the line to **Done**, tick the box, and put
the merge date and the pull request number on it. If the work was abandoned,
delete the line rather than leaving it in **Now** — a stale **Now** is worse
than an empty one.

This file is not a design document. An item that needs a paragraph gets a doc
in `docs/` and a one-line pointer here.
