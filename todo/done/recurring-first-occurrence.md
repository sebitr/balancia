# A recurring expense that starts today is there the moment it is saved

Merged: 2026-10-05 in #426

Saving a series used to leave its first entry to the worker's hourly tick, so
"Recurring entry saved" came with no expense and no change to any balance —
and somebody who then added the expense by hand got it twice. The entries whose
dates have come are now added in the same request, and the confirmation says
whether one was added or the day the first will be.
