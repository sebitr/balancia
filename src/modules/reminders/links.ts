import type { GroupAccess } from "@/lib/security/authorization";
import type { JoinLinkView } from "@/lib/security/join-link";
import type { RemindLink } from "./types";

/**
 * Which address a reminder that leaves the app ends with.
 *
 * It used to be the group's page for everybody. Somebody added by name, with
 * no account, opened it and met a sign-in page that did not name the group,
 * the amount or an invitation — the friendliest message the app sends, ending
 * in a password they did not have. The group's invite link, by contrast, puts
 * them on "Which one of these is you?" with their own name and balance.
 *
 * So the invite link goes to the people it lets in, from the people already
 * allowed to hand it out, while it still works. The three questions are three
 * functions, so each can be tested on its own, and none of them touches the
 * database: `listRemindRecipients` does the one read and asks these.
 */

/**
 * Whether this sender's reminders may carry the group's invite link.
 *
 * Exactly the people who can read the link already, and nobody else: a
 * reminder must never be a second way to get hold of it. That is
 * `manageInvitations`, the permission every screen showing the link reads it
 * behind — the People tab, the group's settings, the empty overview — and the
 * one `GET /api/groups/:id/join-link` demands. Only an owner holds it
 * (`authorization.ts`); a member or a guest keeps the group's address.
 *
 * An API key is turned away even when its owner holds it. The join-link route
 * is a `door` route no key may reach (`api-tokens/scope.ts`), while the
 * reminders route is open to keys — so a link carried in that list would hand
 * a key the one thing its scope exists to keep from it.
 */
export function maySendInviteLink(
  access: Pick<GroupAccess, "permissions" | "actor">,
): boolean {
  if (!access.permissions.manageInvitations) return false;
  return !(access.actor.kind === "user" && access.actor.viaApiToken);
}

/**
 * The invite link as it stands, when a reminder may still carry it.
 *
 * Only a live one. An expired or revoked link opens on "this link no longer
 * works", which is a worse place to land than the sign-in page it was meant to
 * replace; an archived group turns its link away the same way
 * (`resolveJoinLink`); and a link whose sealed copy will not open cannot be
 * shown at all. None of that is repaired from here. Minting, extending or
 * replacing a link is the owner's decision, made on the People tab — never a
 * side effect of opening a reminder.
 */
export function attachableInviteUrl(
  link: Pick<JoinLinkView, "status" | "url" | "expiresAt"> | null,
  { now, groupArchived }: { now: Date; groupArchived: boolean },
): string | null {
  if (groupArchived || !link || link.status !== "active" || !link.url) {
    return null;
  }
  // `status` is as of the read that produced it; the clock asked here is the
  // one the reminder is being composed against.
  if (link.expiresAt !== null && link.expiresAt <= now) return null;
  return link.url;
}

/**
 * The address one person's reminder ends with.
 *
 * Somebody with an account gets the group's page, because signing in is their
 * way in and it lands them there. Somebody without one gets the invite link
 * when there is one to give, and the group's page otherwise. Their own
 * personal link is not an option: it is kept only as a fingerprint, so an
 * existing one cannot be shown again, and making a new one would end the old.
 */
export function reminderLink(
  hasAccount: boolean,
  inviteUrl: string | null,
): RemindLink {
  return !hasAccount && inviteUrl !== null
    ? { kind: "invite", url: inviteUrl }
    : { kind: "group" };
}
