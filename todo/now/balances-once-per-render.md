# Work out every group's balances once per screen, not once per thing on it

Branch: `perf/balances-once-per-render`

Home and the sidebar beside it each walked every group's balances, with
slightly different arguments, so a visit to Home did the work twice. The
command palette did it again on opening and on every pause in typing, only to
match group names and say who is in which group. And a phone pays for the
desktop sidebar's list and the group header's counts on every group screen,
though it never draws either.
