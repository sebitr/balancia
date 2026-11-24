# A recurring expense says how many times it has run, instead of zero for every one

Merged: 2026-11-24 in #494

The recurring list counted each template's occurrences with a subquery in the same select, and Drizzle wrote its columns unqualified, so `recurring_expense_id = id` compared the occurrence with itself and every template read zero. The count is now a grouped query of its own. Written on 2026-09-30 on `fix/recurring-generated-count`, left uncommitted in its worktree, and carried over here after the 2026-11-24 audit found it.
