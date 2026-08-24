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
