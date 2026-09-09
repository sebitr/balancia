# Read the money out of a dictated sentence the way people actually say it: grouped thousands, currency signs, cents after the unit, and the narration in front

Branch: `fix/heard-entry-parsing`

Measured against thirty-nine realistic transcripts in English and French, the
parser got twelve right. Five separate things were wrong, and the first is the
one this parser's own doc calls the failure that counts — a figure nobody
said, in a field nobody was watching.

**A grouped thousand became a unit.** "1,500 euros rent" parsed to **1**,
because the amount pattern took a plain run of digits and stopped at the
comma. So did "1.500", and "1 500", and "2,499.99" became 2. A rent of one
franc, silently, in the balances. The amount is now matched in two shapes,
grouped first, and read by the length of the last group: three digits behind
the final mark is a thousand, one or two is a decimal. That rule holds
whichever way round a locale puts the two marks, which matters because
dictation has no locale — an English speaker's "1,500" and a French speaker's
"1.500" are the same number.

**Currency signs were invisible.** A recogniser writes "30 €" as readily as
"trente euros", and in English closes it up in front: "$24". None of `€ $ £ ¥`
was read, so the amount kept the group's own currency. Signs are now read
before the word is dropped for being part of the amount, which is the only
order that works for "$24".

**Cents after the unit were lost twice over.** "24 euros 50" is how everybody
says twenty-four fifty, and it gave 24 with a stray "50" heading the
description. Only two digits, and only directly after the unit — "10 euros 3
beers" is three beers, and nobody says a single-digit cent.

**The narration stayed in the description.** People say "I paid…", "j'ai
payé…", "on a payé…", "ajoute une dépense de…", and all of it landed in the
field. The leading run now covers those, and the words that merely join the
figure to the thing bought — "for the train", "au restaurant" — are dropped
from the head of the description once there is an amount to join.

That last one bit back, which is why it is worth writing down: dropping
articles turned **Le Gruyère into Gruyère**, and La Poste into Poste. Half the
shopfronts in France open with an article. So an article now leaves only in a
preposition's wake, and a capital letter mid-sentence is taken for the name it
almost always is — the amount has already been said by then, so it is never a
sentence's opening capital. An engine that returns flat lowercase loses
nothing it did not lose before.

Thirty-seven of the thirty-nine now pass. The two that do not are numbers said
as words — "twenty four euros", "vingt-quatre euros" — and they are left
deliberately. Turning words into figures is the one change that could *invent*
an amount rather than miss one: "quatre-vingts" in a shop name is a number to
a parser and a word to a reader, and this file's whole contract is that it
never puts a figure in the field that nobody said. Missing one is the
graceful failure the design already has — the words go to the description and
the reader types four characters. Worth revisiting only with the capitalisation
signal, and on its own branch.
