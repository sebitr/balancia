# Hear who paid and who shares it, and offer them as a chip beside the split row

Branch: `feat/heard-entry-people`

The dictation parser refused to guess the payer, and the reason was good: a
misheard _name_ is the correction people most often have to make, and guessing
at one spends the trust the rest of the feature buys.

That reasoning is about a guess that **disposes**. It is not about an offer.
"Anna paid the 120 taxi, split with me and Jonas" holds a payer, two people
and the split between them, and throwing four facts away because a fifth might
be wrong is the worse trade — the form is a confirm step already. So the
sentence is read for people in `heard-people.ts`, and what it finds becomes two
chips under the split row: **Paid by Anna** and **Split between Seb and
Jonas**. Nothing is written until one is pressed, and a cross takes the whole
offer away.

The trust is bought back by refusing rather than by guessing, which is three
rules and they are all in the tests:

- **A name is only a name if this group has one.** Nothing matches the shape
  of a name, only the roster, so a misheard "Klaus" proposes nobody and leaves
  the words on screen where the reader can see what it thought it heard.
- **A name that could be two people is not a name.** Two members called Anna
  make "Anna" ambiguous, and an ambiguous name resolved by roster order is a
  wrong name wearing a right one's clothes.
- **A list is all of it or none of it.** "split with me and Jonas" in a group
  with no Jonas proposes _nothing_, never "just me". A list that quietly loses
  a member halves a bill and the split row still reads as true.

Two payers — "Anna et Jonas ont payé" — proposes nobody either: that is a
panel with an amount against each name, not a chip, and half of it would be a
quiet lie.

"with" leaves the speaker in the split and "between" leaves them out, because
"split it with Anna" is two people and "split between Anna and Jonas" is a
bill the speaker pays no part of. "just me", "juste moi", "que moi" and "moi
seul" are the other half of what this file's absence used to cost.

No toast on either chip. The row above moved and stayed moved, which is the
confirmation, and the chip that moved it is gone — a toast laid over the row
it was describing would be a slower second copy of both. The component tests
assert the silence.

`heardEntry` keeps its shape: the people parser hands back the character
ranges its clauses filled and `heardEntry` takes an optional `skip`, which is
what keeps "Anna paid" and "split with me and Jonas" out of the description of
a taxi. A clause whose names did not resolve claims nothing, so its words fall
through exactly as they did before.

## What the corpus found

The first cut of the vocabulary was written from the inside, and against a
sweep of a hundred realistic transcripts in both languages it fails 44 of the
108 assertions the test file now holds — 41 of them in the two corpus tables.
Seven faults, none of them in a single rule:

- **Almost nobody says "pay".** They say Anna _got_ the coffees, Jonas
  _covered_ the taxi, Anna _a offert_ the round, Hervé _is paying_. Thirteen
  sentences failed on the verb alone.
- **A comma before a name is not a list.** "dinner 80 francs, Anna paid"
  proposed nobody, because the guard that stops "Anna et Jonas ont payé" naming
  Jonas alone was reading every comma as an enumeration. It now asks whether a
  _name_ ends where the list would have had to start.
- **A comma after one is the sentence carrying on.** "split the bill with Anna
  and Jonas, 90 francs" was demanding a fourth name. A comma now closes the
  list — unless what follows was written with a capital, which is a person the
  roster could not place, and then it is abandoned as before. An explicit "and"
  is still absolute.
- **French rarely puts a name next to its verb.** "c'est Anna qui a payé",
  "Jonas a tout payé", "Anna nous a payé le taxi" — up to three words in
  between, and every one of them was a wall.
- **English says the people first.** "Anna and I split the taxi" has no marker
  at all, and neither does "Anna et moi avons partagé le taxi". Two names or
  more and then the verb — one name would be "Anna split the bill", which says
  who did the dividing and not who it was divided between.
- **The split verb is not next to the marker.** French puts the object between
  them — "on a partagé le taxi avec Anna" — and the taxi in the middle is the
  one word that has to survive. The verb is claimed on its own wherever it
  sits, which is also what turns "split the bill with Anna" into a bill rather
  than into "split the bill".
- **People say "everyone" far more often than they list the group.**

"for" earned a place in the same pass, and it is the one marker that has to:
"gift for Marie" is a present and "coffee for me and Anna" is a split, and what
tells them apart is the speaker being in the list alongside somebody else.

The table is in `heard-people.test.ts` rather than in a scratch script, because
the value was never the one run — it is the table.

Still not here, and for the same reason as the numbers said as words: nothing
resolves a name phonetically. "Ana" for "Anna" proposes nobody rather than
proposing somebody who might be wrong.
