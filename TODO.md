# TODO

The living list of what is planned, in flight, and recently finished. Every
chat reads this before starting and updates it as work moves — see the
_Keeping the list_ section at the bottom for the rules.

One item per line. Keep the newest at the top of its section so two chats
appending at once conflict on different lines.

## Now

Started, on a branch, not yet merged.

- [ ] Make an account cost something to create: free a squatted address, cap sign-ups per inbox and per instance, refuse the passwords everyone guesses, and price out bulk sign-up — `feat/signup-abuse-defences`
- [ ] Offer the passkey in the sign-in field's own autofill dropdown — `feat/passkey-autofill`
- [ ] Give every control a finger's worth of target, and fix five things a UX audit measured — `fix/ux-audit-findings`
- [ ] Settle the French on one register, one glossary and one apostrophe, and hold it there with a test — `fix/french-copy-consistency`
- [ ] Open the calendar when the entry's date row is clicked, not just tapped — `fix/entry-date-picker-opens`
- [ ] Show a payout example from the method's own country, and group the number as it is typed — `feat/payout-country-examples`
- [ ] Skip the list of who to remind when only one person can be asked — `feat/remind-skip-single-recipient`
- [ ] Hold back the Swiss QR-bill address until the IBAN says CH — `fix/payout-address-after-iban`
- [ ] Let the scripts read `.env.local`, so the documented setup works as written — `fix/tsx-script-env`
- [ ] Say what actually ships: audit the status doc against the source — `docs/status-audit`
- [ ] Join preview: agree with the join about a removed member — `feat/join-redeem-api`

## Next

Agreed on, not started. Pick from the top.

- [ ] Share target: register for images, PDFs and text, so a receipt shared from another app lands in the drawer — the other half of `briefs/entry-friction.md` idea 6, left out of the Add Entry rework because it is manifest and route work rather than drawer work
- [ ] Merge somebody into an existing guest when they accept an invite — `briefs/entry-friction.md` idea 7's second half. Match on name, ask, never merge silently: merging two people's balances by mistake is unrecoverable in a way nothing else in this app is
- [ ] Use the whole window on a desktop, instead of a phone column with a bottom bar — `src/components/layout/app-shell.tsx`

## Someday

Worth doing, nobody has committed to it, safe to ignore for months.

<!-- - [ ] Item — pointer to the doc or file that explains it -->

## Done

Merged. Trim entries older than a couple of months; git history is the real
record.

- [x] 2026-08-31 Rework the Add Entry drawer: income vocabulary, settlement pairs, recurrence, entry friction — #271
- [x] 2026-08-30 Settle up with a code the payee's own bank reads, beyond the two SEPA ones — #260
- [x] 2026-08-30 Format the nine files that were committed unformatted — #261
- [x] 2026-08-30 Point the offline journey at the promise the shell now makes — #262
- [x] 2026-08-30 Record an expense with no signal, and send it on reconnect — #259
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
