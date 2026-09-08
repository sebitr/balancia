# Lead the multi-currency home hero on one figure — the largest debt — and drop the rest to compact rows under a count of the currencies

Branch: `feat/multi-currency-hero`

From the "Multi-currency home hero" handoff, option 1a "Action first". Where
there is no rate to combine the currencies, the header gave each of them a
display-size numeral of its own, so an account holding four arrived at four
competing headlines and the list of groups was pushed off the screen. It now
leads on the single largest amount the reader owes — the one fact they can act
on — names the direction in a word beside an arrow, and lists every other
currency as a one-line row ranked debts-first. A badge counts the currencies
rather than totalling them, and a set that nets out in every currency says
"settled up" instead of a column of zeroes.

Two places the handoff was not followed, both deliberate:

- The footer keeps "Add expense" / "New group" with their own glyphs rather
  than the handoff's "+ Dépense" / "+ Groupe". The plus on both said "add"
  twice and told the eye nothing about which one — see the comment above the
  footer in `position-widget.tsx`.
- The converted total is untouched. The handoff says never to show one, on the
  premise that the product has no exchange rate; this one has an optional
  rates provider, and that state already shows exactly one figure.
