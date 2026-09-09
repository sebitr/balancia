# A join link pasted into a chat shows the group's name, icon and colour instead of a naked URL

Merged: 2026-09-09 in #337

Both join routes are redirects, and a redirect carries no meta tag — so
WhatsApp had nothing to draw and rendered the bare address, which is the shape
of every scam its readers have been warned about. They now recognise a
link-preview crawler and answer it with a document: `og:title` carries the
group's name, and `og:image` a card served from `/join/og/<accent>/<icon>`,
a path with no token and no group id in it.

The preview spends nothing, which was a bug as much as a feature: the personal
link used to be _redeemed_ by whatever crawler followed the redirect, minting a
guest session and announcing a stranger's arrival in the group's history every
time it was pasted anywhere.
