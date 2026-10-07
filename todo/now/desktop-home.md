# On a desktop, Home says the day and how many groups are open, puts two currencies side by side, and keeps what changed recently in a column beside your groups

Branch: `feat/desktop-home`

Design: https://claude.ai/artifact/Nwc4hfpwGTdcHj4e7suBHQ (board 01 · Home, board 20 · No groups yet, and 25 · Rules)

Package 8 of the desktop experience. From `lg` (1024px) Home draws its title —
"Your groups", today and how many groups are open, New group at the right —
and the position card loses its two buttons to the sidebar and the title row.
Two currencies with no rate stand side by side at one size; three or more keep
the lead and the rows. Each group row says its figures in words beside them,
one line per currency, and counts its people. From `xl` (1280px) "Recent in
your groups" — the head of the inbox — stands beside the groups; between `lg`
and `xl` it wraps under them. The archived groups' row is a pill; the settled
groups stay rows. A new account's first screen is centred with room above it.
Below `lg` nothing moves.
