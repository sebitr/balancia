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

/**
 * Characters that are drawn like a Latin letter and are not one: Cyrillic and
 * Greek lookalikes, and the digits and marks that stand in for a letter. NFKD
 * already folds the fullwidth and mathematical alphabets; it leaves these
 * alone, and "Сlaude" with a Cyrillic С reads as Claude to anybody looking at
 * the screen.
 */
const LOOKALIKES: Record<string, string> = {
  а: "a",
  в: "b",
  с: "c",
  ԁ: "d",
  е: "e",
  ё: "e",
  һ: "h",
  і: "i",
  ӏ: "l",
  ј: "j",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  ԛ: "q",
  г: "r",
  ѕ: "s",
  т: "t",
  у: "y",
  х: "x",
  α: "a",
  β: "b",
  ε: "e",
  η: "n",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  ı: "i",
  ɡ: "g",
  ℓ: "l",
  "0": "o",
  "3": "e",
  "4": "a",
  "5": "s",
  "|": "l",
  "!": "i",
};

/**
 * Letters only, lower case, accents and lookalikes folded: what "C l a u d e",
 * "CLAUDE" and "Сlаude" share. Two readings, because a "1" is drawn for an l
 * as often as for an i.
 */
function letters(value: string): string[] {
  const folded = [
    ...value
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase(),
  ]
    .map((char) => LOOKALIKES[char] ?? char)
    .join("");
  return ["l", "i"].map((one) =>
    folded.replaceAll("1", one).replace(/[^a-z]/g, ""),
  );
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

  const readings = letters(clientName);
  const host = url.hostname.toLowerCase();
  for (const vendor of VENDORS) {
    const claimed = vendor.claimed.some((word) =>
      readings.some((name) => name.includes(word)),
    );
    if (!claimed) continue;
    const real = vendor.hosts.some(
      (own) => host === own || host.endsWith(`.${own}`),
    );
    if (!real) return { claims: vendor.label, host: url.host };
  }
  return null;
}
