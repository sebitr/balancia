# On a desktop, the group overview gives the money the wider column and says what the spending went on

Branch: `feat/desktop-overview`

Design: https://claude.ai/artifact/Nwc4hfpwGTdcHj4e7suBHQ (board 06 · Group overview, 21 · An empty group, 24 · Group overview, dark, and the 25 · Rules board)

Package 5 of the desktop experience. From `lg` (1024px) up the overview's two
columns are halves, and from `xl` seven to five, the money on the left. The
position card's buttons sit at their own width with "How this is calculated"
at the end of their row, and the hero's strip lines up with the wide column.
The spending card says what the chosen period's spending went on — five
category bars at most in the chart colours, one block per currency. Below
`lg` nothing moves.

Not done, because the code argues against it: the two currencies side by side
in the position card (`position-card.tsx`: "each is its own line … the way the
home screen stacks them") and both currencies' balances open at once
(`currency-balances.tsx`: "One row is open at a time, on purpose"). Both wait
for the owner's call.
