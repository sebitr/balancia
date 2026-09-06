# TODO

The living list of what is planned, in flight, and recently finished. Every
chat reads this before starting and updates it as work moves — see the
_Keeping the list_ section at the bottom for the rules.

One item per line, newest at the top of its section. Two chats appending at
once land on the same line, and `.gitattributes` marks this file `merge=union`
so git keeps both instead of stopping for a conflict — which is why an item's
words must not change when it moves. See _Keeping the list_.

## Now

Started, on a branch, not yet merged.

- [ ] Modernise passkeys: one handle per account so a password manager shows one entry, the Signal API so a removed passkey stops being offered, a silent upgrade after a password sign-in, and a name for the provider each one lives in — `feat/passkey-modernisation`
- [ ] Run the formatter over the file #296 committed unformatted, so main's own CI goes green again, and record #297 where it should have been — `chore/tidy-after-merges`
- [ ] Say in `.gitattributes` that GitHub ignores the union driver, so the next chat stops hunting for a conflict git does not have — `chore/todo-github-union`
- [ ] Keep PGlite out of the bundler, so a demo instance starts instead of answering Internal Server Error on every page — `fix/demo-pglite-external`
- [ ] Clone without the history nobody running an instance reads — `docs/shallow-clone-restore`

## Next

Agreed on, not started. Pick from the top.

- [ ] Give every list item its own file under `todo/`, so two branches never edit the same lines and GitHub stops flagging a conflict git resolves on its own — the union driver in `.gitattributes` fixes the merge but cannot reach GitHub's mergeability check, so every pull request still shows the banner and somebody still merges main by hand to clear it. One file per item makes the anchor per-item: a branch adds `todo/<slug>.md`, moves it between `now/`, `next/` and `done/`, and two branches touching different items cannot collide. Costs a renderer for the list — a script or a README generator — and a rewrite of `src/lib/todo-list.test.ts`, which reads one file today
- [ ] Share target: register for images, PDFs and text, so a receipt shared from another app lands in the drawer — the other half of `briefs/entry-friction.md` idea 6, left out of the Add Entry rework because it is manifest and route work rather than drawer work
- [ ] Merge somebody into an existing guest when they accept an invite — `briefs/entry-friction.md` idea 7's second half. Match on name, ask, never merge silently: merging two people's balances by mistake is unrecoverable in a way nothing else in this app is
- [ ] Use the whole window on a desktop, instead of a phone column with a bottom bar — `src/components/layout/app-shell.tsx`

## Someday

Worth doing, nobody has committed to it, safe to ignore for months.

<!-- - [ ] Item — pointer to the doc or file that explains it -->

## Done

Merged. Trim entries older than a couple of months; git history is the real
record.

- [x] 2026-09-05 Make the repository page do the converting: put the live demo where somebody lands, keep only the badges that carry information, add a donation route, and show several screens instead of one — #297
- [x] 2026-09-05 Reap the worktrees and branches whose pull request has merged, instead of somebody asking every couple of days — #293
- [x] 2026-09-05 Stop TODO.md conflicting on every pull request, and correct the list for what has already merged — #292
- [x] 2026-09-05 Read the favicon journey's colours from the palette the icons are generated from, so `pnpm test:e2e` stops failing on main — #291
- [x] 2026-09-05 Stop asking for a name the account already has: stamp when somebody chose one instead of guessing from the address — #290
- [x] 2026-09-05 Say nothing when a setting saves itself and the control is its own way back — the language list, the format chips, the notification, mute, telemetry and push switches — #289
- [x] 2026-09-05 Let the overview's two actions wrap instead of running off the phone, and shorten the French that made them — #288
- [x] 2026-09-05 Stop deriving the money colours from the accent: one green, one red, one amber on every account, one red for owing and deleting, and the appearance screen down to what earns its place — #287
- [x] 2026-09-04 Stand the mark and the name of a group screen's header on the same pixels the dashboard's wordmark uses, at the same size — #286
- [x] 2026-09-04 Name the two home-screen actions after what they do, and give each the glyph the app already uses for it — #285
- [x] 2026-09-03 Settle three drifts a UX pass found: the tab now says Transactions like the screen it opens, Settle up hands over coins instead of ticking itself done, and every signed figure is written the one way — #284
- [x] 2026-09-03 Take the theme toggle out of the signed-in header; Settings › Appearance already owns it, and only a guest still needs it there — #283
- [x] 2026-09-03 Close the five dead ends an onboarding audit walked into, and the friction around them: guest on a shared link, sign-in through /register, code resend, code-only accounts on the sign-in page, the dark-mode flash — #280
- [x] 2026-09-03 Keep the money colours clear of the accent, and add Paper, Midnight and an increased-contrast setting — #281
- [x] 2026-09-03 Pin browserslist and fast-uri past the advisories that had failed the dependency audit on every branch since 1 September — #282
- [x] 2026-09-02 Offer the passkey in the sign-in field's own autofill dropdown — #279
- [x] 2026-09-01 Make an account cost something to create: free a squatted address, cap sign-ups per inbox and per instance, refuse the passwords everyone guesses, and price out bulk sign-up — #277
- [x] 2026-09-01 Give every control a finger's worth of target, and fix five things a UX audit measured — #276
- [x] 2026-09-01 Settle the French on one register, one glossary and one apostrophe, and hold it there with a test — #275
- [x] 2026-09-01 Open the calendar when the entry's date row is clicked, not just tapped — #273
- [x] 2026-08-31 Rework the Add Entry drawer: income vocabulary, settlement pairs, recurrence, entry friction — #271
- [x] 2026-08-31 Show a payout example from the method's own country, and group the number as it is typed — #268
- [x] 2026-08-30 Skip the list of who to remind when only one person can be asked — #267
- [x] 2026-08-30 Hold back the Swiss QR-bill address until the IBAN says CH — #266
- [x] 2026-08-30 Let the scripts read `.env.local`, so the documented setup works as written — #265
- [x] 2026-08-30 Say what actually ships: audit the status doc against the source — #264
- [x] 2026-08-30 Settle up with a code the payee's own bank reads, beyond the two SEPA ones — #260
- [x] 2026-08-30 Format the nine files that were committed unformatted — #261
- [x] 2026-08-30 Point the offline journey at the promise the shell now makes — #262
- [x] 2026-08-30 Record an expense with no signal, and send it on reconnect — #259
- [x] 2026-08-26 Write down what the join routes actually answer — #245
- [x] 2026-08-26 Build the background translator without dragging React in — #244
- [x] 2026-08-26 Hold on to how somebody arrived once they stop being a guest — #243
- [x] 2026-08-26 Let the phone open a join link without spending it — #242
- [x] 2026-08-26 Join preview: agree with the join about a removed member — #242
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
the merge date and the pull request number on it. **Keep the words.** The line
that leaves **Now** is the line that arrives in **Done**; the tick, the date
and the pointer change, and nothing else does. If the work was abandoned, delete
the line rather than leaving it in **Now** — a stale **Now** is worse than an
empty one.

Keeping the words is not tidiness. `.gitattributes` marks this file
`merge=union`, so where two branches edit the same lines git keeps both sides
rather than raising a conflict. Appending is what that is for, and appending is
most of what this file gets. Deleting is the opposite: union merge has no way to
express a removal, so a line you took out of **Now** comes back if the other
side still holds it. The branch that added the rule merged `main` once and got
all nineteen of the lines it had cleared back in one go, with no conflict and no
mention.
`src/lib/todo-list.test.ts` fails the build when one item's words appear twice,
or when a line carries the pointer of the section it came from rather than the
one it is in. Both only work while the words hold still.

This file is not a design document. An item that needs a paragraph gets a doc
in `docs/` and a one-line pointer here.
