# On a desktop, ⌘K to search or jump to a group, a transaction or a person, and N, S and ⌘\ for the rest

Merged: 2026-10-07 in #454

Design: https://claude.ai/artifact/Nwc4hfpwGTdcHj4e7suBHQ (boards 02 · Command palette, 18 · Settings, 25 · Rules)

Package 3 of the desktop experience. From `lg` (1024px) up, ⌘K (Ctrl K) or the
sidebar's Search opens "Search or jump to": the reader's groups with where
they stand in each, the transactions of the group they are in, the people in
their groups, and Add an expense, Settle up and Open settings — ↑↓ to move, ↵
to open, ⌘↵ for a new tab, Esc to close. N adds an expense (to this group, or
through "Add to which group?"), S settles up in this group and ⌘\ folds the
sidebar; N and S only when no field has the cursor and nothing is open, and a
"Single-key shortcuts" switch under Appearance & language turns them off for
the device. One Server Action answers the palette, reusing the transactions
search and the sidebar's group list. Below `lg` nothing changes.
