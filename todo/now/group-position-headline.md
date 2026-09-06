# Make a multi-currency group's overview state the number instead of explaining the system: headline the currency that matters, fold the settled one into a line, and open the row with money in it

Branch: `fix/group-position-headline`

The third item of a UX pass against the 2026 field. Lisbon Trip opened on two
tiles of equal weight — one saying "Settled EUR", one saying "gets back
USD 8.88" — under a line explaining that Balancia never converts, then two
accordions of which the open one was the settled EUR row, whose whole body was
one sentence saying everyone was square. The card now leads with the figures
the reader is not square in, names a level currency in one muted line, and
keeps the conversion rule in the sheet behind "How this is calculated". A
currency everyone is square in is a flat line in the balances list, with no
chevron and nothing to open, and the row that lands open is the one with money
outstanding in it rather than the group's base currency.
