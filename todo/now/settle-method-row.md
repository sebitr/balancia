# Stop the repayment screen heading its payment methods "Paid by", give the browse tile its name back, and say how this group usually pays

Branch: `fix/settle-method-row`

Three things the Add Entry handoff asked of the "how it was paid" row that #271
did not carry over, found rechecking the section after #334.

**The heading said `Paid by`.** Which in this drawer is the person: the split
summary row is headed `PAID BY` over the payer's face. Here it stood over Lydia,
Wero and Cash — two of which are also first names — so "PAID BY: Lydia" reads as
a member of the group. The section is `Moyen de paiement` / `How was it paid`,
which the picker it opens was already called.

**The `Other` tile turned into a value.** Choosing a method the row does not
show made the dashed tile take that method's name and its selected colour, and
took the magnifier away. The one permanent route into the full list stopped
saying it was one, and the only way back was to guess that a tile reading
"Revolut" still opened the list. It also lit up without an `aria-pressed` to
match, so the selection existed for the eye and not for a screen reader. The
handoff's answer is the right one and is what this does: the chosen method is
promoted to the first tile, `Other` stays `Other`.

**Nothing said how the group usually pays.** The header's right-hand slot held
the country, which explains the three tiles but says nothing about this group.
`Usually TWINT` is what the handoff put there, and a flatshare that has settled
by TWINT eleven times is telling you something worth reading before you tap.
It is a hint and not a default — nothing is preselected, for the reason #276
wrote down — so it gives way to the country once a choice is made, and a group
with no repayments behind it sees the country as before.
