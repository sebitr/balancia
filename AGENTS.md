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
