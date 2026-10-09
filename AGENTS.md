<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# One chat, one branch

Start your own branch before you write anything. Prefer `EnterWorktree`, which
gives this chat its own directory and branches from `origin/main`; use
`git switch -c <type>/<topic> origin/main` if the work truly belongs in the
main checkout.

Never continue on the branch you found checked out. Another chat probably left
it there, and a branch whose upstream is gone is finished — its pull request
has already been merged.

This is enforced, not advisory: `.claude/hooks/guard-branch.sh` refuses edits
on the default branch, on a detached HEAD, and on any branch whose upstream has
been deleted. The rule exists because four unrelated features — data export,
participant names, the dashboard rewrite and an auth fix — were once found
stacked in one working tree on `feat/docker-dev-env`, which was itself already
merged. Splitting them apart afterwards cost far more than branching would have.

Keep a branch to one topic. If a second, unrelated thing needs doing, it gets
its own branch.

You do not have to clear up after yourself, and you should not have to be
asked to. `.claude/hooks/reap-merged.sh` runs at session start and takes away
the worktrees, local branches and remote branches whose pull request has
merged. It was written when sixteen worktrees, seventeen local branches and
twenty remote branches had piled up, every one of them merged, plus a
stranded checkout of a worktree somebody had deleted by hand that was still
holding 1.1 GB.

It removes something only when the pull request reads MERGED, the branch is
still at the very commit that pull request merged at, no pull request of the
same name is open, the worktree is clean, and no session that is still running
holds its lock. **A branch that never had a pull request is never touched**,
however abandoned it looks — that is the rule protecting work in flight, and it
is why the reaper walked straight past `docs/shallow-clone-install` on its first
run. Without `gh` to ask, it touches nothing at all. It throttles itself to
once a half hour, and `--dry-run` says what it would take without taking it.

The commit is the part that is easy to leave out, because a name looks like an
identity and is not one. Weblate opens every translation pull request from the
same branch, `weblate-balancia-messages`, and while the reaper matched on names,
#188 having merged under it once was enough to delete each new one at the next
session start: six pull requests between #349 and #362 closed unmerged before
anybody saw why. `src/lib/reap-merged.test.ts` runs the script against a
throwaway repository and a stand-in `gh` to keep it that way.

While it has the merged set in hand it also reads `todo/now/` off
`origin/main`, and names any item still pointing at a branch that has merged,
by the same rule, with the `Merged:` line to write. That half is a notice and never an edit — a
`now/` that has stopped saying what is in flight is the failure this repository
keeps having, and the one thing that runs after a merge is the only thing left
placed to catch it.

The remote half is settled at the source: the repository now has
`delete_branch_on_merge` on, so GitHub deletes each head branch as its pull
request merges. The reaper's remote pass is for the backlog and for anything
merged while that setting was off.

# The list of work lives in todo/

One file per item, in the directory that says what state it is in: `todo/now/`,
`todo/next/`, `todo/someday/`, `todo/done/`. `pnpm todo` prints the lot, and
`todo/README.md` has the rules in full.

Read `todo/now/` before you start. An item sitting there with a branch against
it is being done in another worktree right this minute, and picking it up again
is how two chats end up writing the same feature twice. The filename is the
branch's last segment, so the listing _is_ the set of branches in flight.

Move the file you are working on into `todo/now/`, rename it after your branch,
and put a `Branch:` line in it — as part of the change, in the same commit, a
list updated afterwards being a list nobody updates. Delete it outright if the
work is abandoned. Keep the heading wherever it moves: it is what somebody
recognises the item by months later.

Filing it as done is the one half that cannot ride along in that commit, since
`Merged: <date> in #<pr>` wants two facts that do not exist until the pull
request has merged and the chat that wrote the item has gone. It is a small
branch of its own, afterwards — and on goodwill alone it does not happen, which
is why `.claude/hooks/reap-merged.sh` now names the items waiting for it.

This was one file until #304, and it was the worst thing in the repository for
merge friction: every branch appended to the head of the same two sections, so
a three-way merge conflicted on 23 of 30 consecutive pull requests. Marking it
`merge=union` fixed git and nothing else — GitHub does not apply merge drivers,
so its mergeability check re-derived the conflict the driver had resolved, and
every pull request showed the banner again each time main moved. Union merge
also could not express a deletion, so a line cleared from **Now** came back
silently. Separate files end both: two branches touching different items have
nothing to conflict over, and a rename is something git merges rather than
argues about.

`src/lib/todo-list.test.ts` fails the build on what the shape cannot enforce —
an item with no heading, a `now/` file with no branch, a `done/` file with no
pull request, two items claiming one branch, or a committed `TODO.md`, which
would be one more file every branch edits at the same two anchors.

Nothing else enforces this, which is exactly why it is written down here.

# Adding a setting touches six files

A new environment variable is never one edit. It lands in:

1. `src/lib/env.ts` — schema entry, any `superRefine` rule, and an accessor if
   `proxy.ts` needs it per request without parsing the whole schema
2. `.env.example` — with the prose an operator reads before setting it
3. `compose.yaml` and `compose.dev.yaml` — the forwarded lists; a value set in
   `.env` and not named there reaches the container as nothing
4. `scripts/bootstrap.sh` — the question, the repairs section, and the summary
5. `docs/environment.md`, plus whichever feature doc the setting belongs to

`src/lib/env.test.ts` catches two of those on its own: a variable the compose
files do not forward, and a variable nothing in `src/` or `scripts/` reads
(comments do not count as reading it). It does **not** catch a missing
bootstrap question or a doc that still describes the old behaviour — those are
on you, and the wizard is the one most often forgotten.

# Fields are never smaller than 16px on a phone

Safari on iOS zooms the page in whenever a control it can put a caret or a
picker in — `<input>`, `<textarea>`, `<select>` — takes focus below 16px, and
it never zooms back out. The reader is left on a scaled-up layout they have to
pinch out of by hand, once per field they tap.

So a text-entry control carries `text-base`, and the size it was actually
designed at comes back from `md:` up: `text-base md:text-sm`. `Input` and
`Textarea` already do this, so a call site only has to say it when it overrides
the size — and an override is exactly how this bug gets back in. Note that the
phone scale is a point larger than the desk one, so `text-sm` is 15px on a
phone: still under the line.

Buttons and Radix triggers are exempt, as is `<input type="file">` — the
browser only zooms for controls it can type into.

`src/components/ui/text-entry-size.test.ts` fails the build on a control that
states a size below the line, so do not go looking for these by eye. A control
that states no size at all is fine: `globals.css` floors every one of these
three elements at `max(1rem, 1em)` below `md`, from `@layer base`, where any
explicit `text-*` still outranks it. The long form is in
`docs/development.md` under _Notes on the stack_.

# Seven type sizes, and the phone gets a point more

`text-2xs` `text-xs` `text-sm` `text-base` `text-lg` `text-xl` `text-2xl`, as
drawn in `design-system/src/pages/foundations/typography.html`. An arbitrary
`text-[…]` inside the product is a bug — the scale had drifted to fourteen
sizes, 13px spelled both `text-[13px]` and `text-[0.8125rem]`, with a
half-point tier below that, which is how two labels showing the same kind of
thing ended up a point apart on one card. The balance heroes are the exception:
those display numerals are deliberate one-offs.

`src/components/ui/type-scale.test.ts` fails the build on an arbitrary size
below the top of the scale, so the one-offs stay allowed and the drift does
not. It was written after the entry detail screens were found rendering a 10px
uppercase label on a phone: they had been transcribed from a 390pt handoff as
literals, and a literal sits out the point every step gains below `md`.

`text-2xs` is the floor, and it is for labels — avatar initials, a badge count,
a category pill, a chart axis tick. Nothing read as a sentence goes there. A
footnote or a caption starts at `text-xs`.

Every step is a point larger below `md`, set once by redefining `--text-*` in
`globals.css`. Never move those tokens into an `@theme inline` block — inline
substitutes the value and the whole lever stops working.

The marketing homepage (`src/app/page.tsx`, `src/components/marketing/`) is not
covered by any of this. It is an editorial surface with its own scale; leave it
alone.

# The money colours never move, and the accent never paints one

Green means somebody owes you, red means you owe, amber marks who paid. Those
three are the only colours in the app that carry meaning, and they are
literals in `globals.css` — the same on every account, in every accent. **Do
not derive them from anything.**

This was tried the other way round and it is worth knowing why, because the
idea is a natural one and it will occur to you too. The accent is the one
colour a reader chooses, and three of the seven sit on a money colour: coral,
the default until plum replaced it, is two degrees from the "you owe" red;
mint _is_ the "gets back" green; amber is the payer. So each money hue used to be rotated away from the
accent until it was forty degrees clear. The result was a pink "you owe" for
the default accent, an olive "gets back" under mint and a chartreuse payer
under amber — and the rule was not merely badly tuned, it was unsatisfiable.
In the dark theme the seeds sit at L 0.70–0.78 and the money fills at
L 0.72–0.82, and an ink is walked in lightness until it clears 4.5:1, so two
inks of similar chroma converge on one lightness whatever hue they began at.
That leaves hue as the only axis, hue needs about thirty degrees before the
eye separates two fills at this chroma, and thirty degrees is exactly enough
to stop a red being red. Searching the whole feasible red band finds nothing
better than a pink. The argument, with the numbers, is at the top of
`src/modules/profile/accent.test.ts`.

So the accent is allowed to be a money colour's neighbour, and what keeps a
balance legible is not its hue. It is these two rules:

**Colour never carries the meaning alone.** Every figure has a sign and a word
beside it, from `TONE` in `src/components/money/balance-tone.ts`.

**The accent never colours a money surface.** `--primary` is the button, the
ring, the link, the "you" pill and the "you" series in a chart. An amount, a
balance bar or the chip above a figure takes its tone from `TONE`, never from
`--primary` — and a token that ends in `-ink` is text, the one without the
suffix is a fill, and putting a fill on text is how a 2.6:1 figure gets back
in.

The accent is still a seed — `ACCENT_SEEDS` in `src/modules/profile/accent.ts`
— but all it owns now is its own fill and an ink per theme, six variables
painted inline on `<html>`. A new accent goes in `ACCENT_SEEDS` and nowhere
else.

`src/modules/profile/accent.test.ts` holds all seven to 4.5:1 (7:1 under
increased contrast) on every surface, spells the inks out as a table, and
asserts that no money token is built from a `var()` — that last one is what
stops the rotation coming back. `src/app/token-contrast.test.ts` reads
`globals.css` and checks the inks and the chart colours across every surface
and contrast combination. Surfaces and contrast are override blocks at the
bottom of `globals.css` whose selector order is load-bearing; the comment
above them says why.

# A control that flicks back says it for itself

Settings have no Save button anywhere: a switch, a chip, a swatch or a row in a
tick list is written the moment it is pressed. Where that is true and the same
control puts the change back in one press, it needs no toast. The control moved
and stayed moved, which is the confirmation; it is still under the finger,
which is the way back. A toast there is a slower second copy of both, laid over
the rows it is describing — on the appearance screen it covered the heading to
announce a language the whole page had already changed into.

So the language list, the date and number chips, the accent, the dark surface,
the theme, the notification switches, the per-group mute switches, the two
telemetry switches and the push switch all save in silence.

What still gets a toast is what the control cannot carry:

- **A refusal.** The control goes back to what is stored — never left showing a
  value the account did not keep — and the error is spoken, because nothing on
  screen can say it.
- **Something that has left the screen.** A deleted entry, a removed person, a
  dismissed row, another device unsubscribed. There is no control to press
  again, so the toast carries the Undo.
- **A change that took more than a tap.** A typed field, a picker, a sheet —
  the display currency comes out of a search over 165 of them. Reversing that
  is the journey again, which is the gap `toastUndoable` exists to close.

The doctrine is written out at `toastUndoable` in
`src/components/ui/sonner.tsx`, and the component tests for those screens
assert the silence — `expect(toastSuccess).not.toHaveBeenCalled()` — because a
confirmation is exactly the kind of thing that creeps back in one screen at a
time.

# A public page has one address per language, and the tracker stays on them

The homepage and the comparison pages are the only pages meant to be found.
They are one table, `SLUGS` in `src/lib/public-pages.ts`, and the proxy, the
alternate links, the sitemap, `/llms.txt` and the tracker's list of pages all
read it. `docs/seo.md` is the long form.

**The address is the language.** `/` is English and `/fr` is French, to
everybody: a crawler sends no cookie and no `Accept-Language`, so while the
homepage chose its language from those the French copy was in no index at
all. `proxy.ts` reads the language off the path and hands it to the render in
`x-balancia-locale`, which `resolveRequestLocale` reads before the cookie.

**Never serve one by rewriting to the English file.** It is the obvious
design and was the first one. Next runs the proxy again on the path a rewrite
points at, so `/fr`, rewritten to `/`, came back through as `/`, was told it
was English, and rendered in English at a French address — with a first-pass
response every unit test passed. Nor from one `[locale]` route at the root: a
dynamic segment there answers every one-segment path nothing else claims, and
the linter then takes each deliberate `<a href="/dashboard">` for a link to
it. A language is a folder, `app/fr/`, of two small files.

Adding a page is a row in `SLUGS`, a folder under `src/app` named after its
English slug, and its copy. Adding a language is its folder.
`src/lib/public-pages.test.ts` fails on either with no route behind it.

**The page counter reports the public pages and nothing else, and where its
tag is mounted is not what makes that true.** It was taken to be. The tracker
hooks the browser's history when it loads, signing in is a navigation rather
than a page load, and so it followed every reader who signed in from a
counted page into the application: 96 addresses with a group or an expense
identifier in them reached the collector before anybody read its page list.
What is sent is decided at the moment of sending, by address, in the hook in
`src/lib/analytics/bridge.ts`:

- `COUNTED_PATHS` is a list of exact addresses. Do not make it a pattern.
- The tracker's tag is written by the script that defines the hook, never
  into the HTML beside it — a tracker that finds no hook sends everything.
- An event is a literal type in `src/lib/analytics/events.ts` or it does not
  exist; there is no `track(name, payload)`.

`src/lib/analytics/bridge.test.ts` runs the shipped script against group
addresses. `docs/telemetry.md` §17 is what an administrator is told, and
changes with the code or not at all.

**`COMPARISON_REVIEWED` is a fact.** It is the day somebody last read the
other product's own pages and checked every row. It is printed on the page
and is the pages' `lastmod`. Move it on a day you have done that, never to
make a page look fresh.

# A backup the server can read is not a backup this feature promises

Cloud backup (`src/modules/backup/`, `docs/cloud-backup.md`) tells a group owner
that neither this server nor their cloud can read what it writes. That is a
claim about code paths, and it is kept by four rules that are easy to break
with a change that looks like a convenience.

**The private half of the recovery key never reaches the server.** The browser
makes the `AGE-SECRET-KEY-1…` identity and sends the `age1…` recipient.
`parseRecipient` refuses an identity outright, so a client that sends the wrong
string by mistake is refused rather than stored. Do not add a "recover your
key" path, a server-side key generator "for people without JavaScript", or a
field that holds the identity even briefly: there is no copy to recover, and
that is the feature. `src/modules/backup/age.test.ts` and `restore.test.ts`
include the real `age` command opening our files, so the format stays one a
person can open without Balancia.

**`rclone-config.ts` is the only file that names an rclone option, and the
child is given nothing else.** Every value comes from a schema in
`providers.ts` first; no typed string is ever an option name, and `local`,
`alias` and `crypt` are not types a person can reach. `rclone.ts` builds the
child's environment from nothing — it never inherits `AUTH_SECRET` or
`DATABASE_URL` — puts passwords on stdin or in that environment and never in
argv, and scrubs every secret it was given out of anything it reports. A change
that spreads `process.env` into the child, or interpolates a credential into a
path, is the change this paragraph exists to refuse.

**Deletion in somebody's cloud is as narrow as a name.** Retention considers a
file only if `parseBundleName` accepts it, never touches the newest N, and never
touches receipts. A README, a copy made by another tool, a renamed file: none
match, none are deleted. Anything that would delete by modification time, by
extension or by "everything older than" belongs to a different feature with its
own consent screen.

**A run never throws at the queue.** `runBackup` records every outcome — a row
in `backup_runs`, a code, a retry time that backs off — and returns. pg-boss's
own retry is immediate, which is exactly wrong for a revoked token and how an
account gets flagged by its provider. A revoked destination
(`needs_reconnect`) is not retried at all until its owner acts.

Two things this feature cannot honestly claim, kept in `docs/cloud-backup.md`
and not to be softened: the recovery key is made by JavaScript this server
serves (a hostile operator could capture it; the answer is `age-keygen` on the
owner's own machine), and the Google, Dropbox and OneDrive requests have been
tested against the providers' documented answers, not a live account — the
checklist at the end of that page is the list of what remains to be run by hand.
