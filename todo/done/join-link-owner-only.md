# Keep the group-wide join link the owner's over the mobile API, and hand them the link itself rather than its first eight characters

Merged: 2026-09-08 in #326

The web has always read this link behind `manageInvitations`, which is the
owner's alone: the group overview, the members page and the settings page all
fetch it only when that flag is set, and the three write paths go through
`requireLinkAdmin` in `src/modules/join/actions.ts`. The mobile route checked
that the caller was in the group and nothing else, on the strength of a comment
claiming any member may share the group they are in — which the web does not do
and never has.

What that left open is a guest, who is somebody holding an invitation that was
forwarded to them: they could mint a fresh group-wide link and keep the URL, a
standing way in for themselves and anybody they passed it to, and they could
revoke the owner's.

The second half is the field the phone was waiting for. `describeJoinLink` has
returned a `url` since the token gained a sealed copy beside its hash, and the
web shows it; the mobile route kept answering with the prefix alone, so the
phone could name a live link it had no way to hand over. That is why the group
overview's "Start here" card ships without its link row — see the iOS repo's
`OverviewTab.startHere`.
