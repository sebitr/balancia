# Get the format job back to green, and file the finished items that were still sitting in Now

Branch: `chore/format-and-todo-sweep`

CI's "Lint, types and format" job had been red on `main` for several merges.
Only `prettier --check .` was failing, on six files: two docs, two source files
and two `todo/` items. Nothing here is behaviour — `--write` moved whitespace,
re-wrapped two markdown tables, and normalised four `*emphasis*` markers to the
`_emphasis_` prettier writes. `pnpm lint`, `pnpm typecheck` and `pnpm test` say
the same as they did before it.

This is the second time: #261 was "Format the nine files that were committed
unformatted". The pre-commit hook is not catching these, which is the thing
actually worth fixing — a file reaches `main` unformatted only if it was
committed by something that skipped the hook.

The other half is filing. Every one of the twenty-three items in `todo/now/`
had a merged pull request and none had an open one, so `now/` had stopped
saying what was in flight and was saying what had been in flight since #304.
They move to `todo/done/` with the merge date and number their branch actually
carries. `todo/now/` is empty as a result, which the reader already expects —
`scripts/todo-list.ts` treats a state with no directory as a state with no
items, which is how `todo/someday/` has always been.
