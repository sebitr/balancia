# Hear who paid and who shares it, and offer them as a chip beside the split row

Branch: `feat/heard-entry-people`

The dictation parser refused to guess the payer, and the reason was good: a
misheard *name* is the correction people most often have to make, and guessing
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
  with no Jonas proposes *nothing*, never "just me". A list that quietly loses
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

Still not here, and for the same reason as the numbers said as words: nothing
resolves a name phonetically. "Ana" for "Anna" proposes nobody rather than
proposing somebody who might be wrong.
