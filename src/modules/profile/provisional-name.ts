/**
 * Whether an account is still called by the local part of its address.
 *
 * The code signup creates the account before its name screen, with the
 * address's local part standing in — it is what the authenticator shows in
 * its prompt — and the name screen overwrites it a few seconds later. Anyone
 * who closes the tab between the two is "cold-mtke" to their group from then
 * on, and nothing asks again. This is the test for that state, so the
 * dashboard can.
 */
export function isProvisionalName(name: string, email: string): boolean {
  const localPart = email.split("@")[0] ?? "";
  if (localPart.length === 0) return false;
  return name.trim().toLowerCase() === localPart.trim().toLowerCase();
}
