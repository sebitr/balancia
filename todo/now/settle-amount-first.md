# Redraw Settle up amount-first: a hero position and a bar saying what it is made of, payments as flat rows instead of cards, the payment rails in a panel inside the row that owes them, and a settled group that reads as a state

Branch: `feat/settle-amount-first`

Recreates the "Régler les comptes" handoff (states 3a, 2a and 4a) with the
app's own components. Two places where the handoff and `AGENTS.md` disagreed
went the app's way: the composition bar takes its fill from `TONE` rather than
the accent, because a balance bar is a money surface, and the coordinate row
stays monospace for every method rather than only the Revtag. The in-place
done states the prototype draws are not built — recording opens the add-entry
drawer this screen already hands off to, and the row is gone when the balances
come back.
