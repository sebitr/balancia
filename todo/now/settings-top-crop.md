# Give the first settings card back the pixel its outline is drawn in

Branch: `fix/settings-top-crop`

Every card on a settings screen is outlined with `ring-1`, and a ring is
painted outside the border box. The scrolling column carried no top padding, so
the first card's box sat exactly on the sticky header's bottom edge and that one
pixel was painted over by a `z-10` bar with `bg-background/80` and a backdrop
blur: the top card arrived with three sides. `pt-px` on the column is the fix,
and it covers the detail screens too — their first card is flush against the
header in the same way.
