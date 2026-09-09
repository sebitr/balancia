# Close four gaps the Add Entry handoff left open: a repayment in another currency that claimed to settle a debt, the split back above the date, the type tabs and the ways in held in the header, and the split row drawn as a picture

Merged: 2026-09-09 in #334

The drawer shipped in #271 from a handoff exported the day before, and four of
its decisions did not survive the port. Three are layout; the fourth was a
false sentence.

The false one first. The handoff pinned a repayment to the group's base
currency _in the model_, because the outstanding balance is held in base and
comparing a payment in another unit against it produces a settlement that did
not happen. #271 reopened the currency pill deliberately and rightly — a debt
in a `separate` group has no base to pin to, and paying forty euros back on a
forty-euro debt should not have to be retyped as francs — but kept comparing
the raw minor units. Picking a CHF 128.40 debt, switching the pill to EUR and
typing 128.40 announced that the two of you were settled.

So the pair carries the currency its debt is in, the payment is restated in
that currency before anything is compared, and the two cases where it cannot
be say so instead of guessing: a converted group whose rate has not been typed
yet asks for the rate, and a `separate` group paying in a currency the debt is
not in says the debt is unchanged, which it is.

The three layout ones are the handoff's own non-negotiables 2, 3 and 5: the
split summary sits above the date because the date defaults to today and the
split is the most-corrected fact in the entry; the type tabs and the ways in
that skip the form stay in the fixed header rather than scrolling away under
the keyboard; and the summary row states the outcome as a picture — payer,
arrow, the faces it is split between, and the per-person figure in a strip
below — instead of as a sentence that repeated the total already 44px above it.

Shipped copy was kept wherever the two disagreed; the only new strings are for
the two currency states, which had nothing to say before.
