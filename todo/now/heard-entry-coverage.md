# Read the figure the currency is attached to, not the first one in the sentence

Branch: `fix/heard-entry-coverage`

A sweep of a hundred-odd realistic transcripts across English and French. It
started at 75 of 83 and found four separate faults, none of which was in a
single rule — they were all collisions between rules, which is why none had
shown up on the cases written to exercise one at a time.

## The first figure is not the money

"2 coffees 8 francs" was an expense of **two** francs described as "coffees 8".
So was "3 beers 15 euros", "2 billets de train 90 francs", and every other
sentence where somebody counts out loud — which is most of them, because the
count goes first in both languages.

The figure is now read from the unit stuck to it: the one written into the
same word for "$24", else the nearest one behind it, else the first one in
front for "CHF 24", where the unit leads. Only a sentence with no unit at all
falls back to the first figure. As a free consequence "12/03 dinner 45 francs"
and "dinner for 4 people 120 francs" both come out right, which the old rule
had no way to manage.

## Three-letter words that are currencies

`cup`, `pen`, `top`, `mad`, `bob`, `gel`, `sos`, `all`, `lak` — every one an
ISO code somewhere. The lookup folded case first, so **"coffee cup 5 francs"
came back as five Cuban pesos**, described as "coffee francs": the cup had
taken the currency, so the francs never could, and were left in the words.

A written code is now matched only where it was written as one. Capitals are
the whole test: a recogniser writes CHF and EUR in capitals, a person saying
"cup" does not.

## 1'200 is twelve hundred

Switzerland groups thousands with an apostrophe, this app defaults to francs,
and a rent dictated as "1'200 francs" was read as **200**. Same class as the
"1,500 → 1" bug fixed in #331 and missed for the same reason: the separator
list was written from the outside.

## Two smaller ones

"I bought coffee for 5 francs" kept a dangling "for" — joining words are now
dropped from the end of the description as well as the front, for the
sentences that put the figure last. And "50 francs 20 centimes" left the word
"centimes" behind once the figure was taken.

## Deliberately still not here

Numbers said as words — "vingt francs", "twenty four euros". Same reasoning as
#331: turning words into figures is the one change that could invent an amount
rather than miss one, and missing one is already the graceful failure.

The corpus is in the test file now rather than in a scratch script, because
the value was never the one run — it is the table.
