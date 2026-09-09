# Draw the amount at whatever size shows all of it

Merged: 2026-09-08 in #328

The figure on the entry and repayment card is 44px, which holds about seven
characters before the currency chip beside it. Settling a five-figure debt is
eight — `12801.75` — and the last digits scrolled out of the field with nothing
on screen to say so, which reads as a different amount rather than as a crop.

The size is now measured against an invisible copy of the text and scaled to
whatever fits, down to the 16px floor the iOS zoom rule sets — a floor, not a taste,
and low enough that the longest amount `sanitiseAmount` will accept still fits
inside it on a 320px phone.
