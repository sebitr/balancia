# Add a recurring expense at nine in the morning, group local, rather than at midnight — generating one notifies everybody it splits between, and the rent should not wake the flat

Branch: `claude/recurring-expense-timing-2jkklz`

The date was never wrong; the hour was. `occurrenceInstant` resolved an
occurrence to midnight in the group's zone, and generating an expense writes a
notification for every participant and pushes it — so a monthly rent arrived at
00:00 on the first of every month, on everybody's phone.

One constant, `GENERATION_HOUR` in `src/modules/recurring/schedule.ts`, and its
counterpart `dueThrough`. The constant is the easy half: `next_run_at` is now
09:00 on the occurrence date in the group's zone, and the hourly worker tick
covers every zone's nine the same way it covered every zone's midnight.

`dueThrough` is the half that is easy to miss. The worker used to generate
everything up to _today_, which is fine while `next_run_at` is the only gate —
but a container that comes back from an outage at three in the morning is past
every overdue marker at once, and would have generated today's occurrence at
three and notified the group at three. An occurrence is due when its own 09:00
has passed, so that is what the run is measured against now.

Two smaller things fell out. Midnight is the hour daylight saving actually
deletes in Santiago, Havana and Tehran, where `startOf("day")` was quietly
landing on 01:00; 09:00 exists everywhere. And the recurring list renders
`next_run_at` in the _reader's_ zone, so a midnight marker showed the day
before to anybody west of the group — nine hours of margin covers that.

`0037_recurring_generation_hour.sql` moves the templates that already exist,
and only the ones whose next run is still ahead: pushing an overdue one nine
hours further out would delay a catch-up that was owed, and the worker rewrites
`next_run_at` from the rule every time it looks at a template anyway. That is
also why the migration can afford to skip a row whose zone this Postgres has
never heard of rather than failing the deployment over it.

The phone app needed nothing. `Balancia/Core/Recurrence.swift` is date
arithmetic and builds no instant at all — which zone and which hour an
occurrence lands on has always been the server's business.
