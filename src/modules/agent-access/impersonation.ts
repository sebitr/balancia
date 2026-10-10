/**
 * Whether an application is calling itself something it is not.
 *
 * Registration is open, so the name on the consent screen is whatever its
 * registrant typed — and the screen says so. A person deciding whether to press
 * Allow reads that name first, though, and anybody can type "Claude". What a
 * stranger cannot borrow is where the answer will go: the real Claude sends
 * the person back to its own address. So a name that claims a well-known
 * assistant while the answer is bound for somewhere else is the one thing a
 * consent screen can say something definite about, and it says it.
 *
 * Only the assistants that run on the web are listed, because only they have an
 * address to compare with. A native application — Claude Code, Cursor, an
 * editor — comes back to the person's own computer or to a scheme it
 * registered, and a name on one of those proves nothing either way, so it is
 * left alone rather than warned about.
 *
 * Pure, so the rule can be tested without a database.
 */

const VENDORS = [
  {
    label: "Claude",
    claimed: ["claude", "anthropic"],
    hosts: ["claude.ai", "claude.com", "anthropic.com"],
  },
  {
    label: "ChatGPT",
    claimed: ["chatgpt", "openai"],
    hosts: ["chatgpt.com", "openai.com"],
  },
] as const;

/** Letters only, lower case, accents off: what "C l a u d e" and "CLAUDE" share. */
function letters(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export interface Impersonation {
  /** Who the application says it is. */
  readonly claims: string;
  /** Where the answer would really go. */
  readonly host: string;
}

/** The claim and the address it does not match, or null when nothing is off. */
export function impersonation(
  clientName: string,
  redirectUri: string,
): Impersonation | null {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return null;
  }
  // Only a web address can be compared with a vendor's.
  if (url.protocol !== "https:") return null;

  const name = letters(clientName);
  const host = url.hostname.toLowerCase();
  for (const vendor of VENDORS) {
    if (!vendor.claimed.some((word) => name.includes(word))) continue;
    const real = vendor.hosts.some(
      (own) => host === own || host.endsWith(`.${own}`),
    );
    if (!real) return { claims: vendor.label, host: url.host };
  }
  return null;
}
