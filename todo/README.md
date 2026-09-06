# The list of work

What is planned, in flight and recently finished. One file per item, in the
directory that says what state it is in:

```
todo/now/      started, on a branch, not yet merged
todo/next/     agreed on, not started — pick from here
todo/someday/  worth doing, nobody has committed to it
todo/done/     merged
```

`pnpm todo` prints the lot. Nothing renders it into a committed file, and that
is deliberate — see _Why a directory_ below.

## An item

The filename is the slug, and while work is in flight it should be the branch's
own last segment: `feat/member-header-name` owns `todo/now/member-header-name.md`.
That way the listing reads as the set of branches in flight, and two chats
cannot pick the same name without noticing.

Inside, a heading and a pointer:

```markdown
# What changes, in the words a user would recognise

Branch: `feat/member-header-name`
```

The pointer is one of three lines, and which one you get says which directory
the file belongs in:

| Line                           | Means                                 |
| ------------------------------ | ------------------------------------- |
| ``Branch: `feat/thing` ``      | Being done now, on that branch        |
| `Merged: 2026-09-05 in #292`   | Finished                              |
| ``See: `docs/mobile-api.md` `` | Not started; here is what explains it |

Anything below that is for whoever picks the item up — a paragraph of context,
what was tried, what to watch out for. Most items need none. An item that needs
several paragraphs gets a doc in `docs/` and a `See:` line pointing at it.

## Moving an item

**Starting work:** move the file into `todo/now/`, rename it after your branch,
and add the `Branch:` line. Do it in the same commit as the work — a list
updated afterwards is a list nobody updates.

**Finishing:** move it to `todo/done/` and swap the `Branch:` line for
`Merged:`. **Keep the heading.** It is what somebody recognises the item by
months later.

**Abandoning:** delete the file. A stale `now/` is worse than an empty one.

Moving is `git mv`, not copy-then-delete: git tracks the rename, and a rename
merges cleanly against a branch that only edited the file's contents.

## Why a directory

This was one file, `TODO.md`, and it was the single worst thing in the
repository for merge friction. Every branch appended a line to the head of
**Now** and later moved it to the head of **Done** — two anchors, edited by
every branch, which a three-way merge calls a conflict. It conflicted on 23 of
30 consecutive pull requests before somebody counted.

`.gitattributes` marked it `merge=union`, so git kept both sides instead of
asking. That fixed git and nothing else. GitHub does not apply merge drivers
from `.gitattributes`, so its mergeability check re-derived the conflict the
driver had just resolved, and every pull request showed "This branch has
conflicts that must be resolved" the moment another branch touched the list —
not once, but again every time main moved while the pull request stayed open.

Union merge also could not express a deletion. A line taken out of **Now** came
back if the other side still held it, silently: the branch that added the rule
merged main once and got all nineteen lines it had cleared back in one go, with
no conflict and no mention. `src/lib/todo-list.test.ts` existed mostly to catch
that.

One file per item ends both. Two branches touching different items have nothing
in common to conflict over, and a rename is something git merges rather than
argues about. The test that remains checks what the shape cannot: that every
item says what changes, that `now/` names a branch and `done/` names a pull
request, and that no two items claim one branch.

And nothing generates a committed copy of this list, because a checked-in
rendering would be one more file every branch edits at the same two anchors —
the whole problem again, with an extra step.
