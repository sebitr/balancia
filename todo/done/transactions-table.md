# Read a group's transactions as a table on a desktop, with the filters on one row above it

Merged: 2026-10-06 in #448

Design: https://claude.ai/artifact/Nwc4hfpwGTdcHj4e7suBHQ (board 07 · Transactions, board 05 · 1024 px, and the table recipe on 25 · Rules)

From `lg` (1024px) up, the transactions list is drawn as a table — Date,
Description with its badges and receipts, Category, Paid by, Split, Amount and
For you — folding the middle columns into the description's second line when
the table's own box is too narrow for them. The kind chips, a Category menu, a
When menu, More filters (the existing sheet) and Add an expense stand on one
row above it, in place of the category spine. One loader and one filter feed
both renderers; below `lg` nothing moves.
