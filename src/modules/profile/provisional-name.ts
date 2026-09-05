/**
 * The name an account carries before anybody has said what to call it.
 *
 * Two signups create the account before its name screen — the code and passkey
 * routes, where the address is asked for first — and an Apple sign-in may
 * arrive with no name at all. All three need *something* on the row: it is the
 * heading of the first screen the reader sees, and it is what the
 * authenticator shows in its prompt. The address's local part is the best
 * placeholder available, and it is derived here rather than at each of those
 * three places so that "is this still a placeholder?" has one answer.
 *
 * That question is not asked of this string, though. It is asked of
 * `users.name_chosen_at`, which the paths that take a name from a person
 * stamp and these do not — because comparing a name with a local part cannot
 * tell a placeholder from somebody called Seb whose address is seb@, and the
 * dashboard used to nag that second reader on every load.
 */
export function provisionalNameFor(email: string): string {
  const localPart = email.split("@")[0]?.trim() ?? "";
  return localPart.length > 0 ? localPart : email;
}
