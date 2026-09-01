/**
 * The passwords an attacker tries first.
 *
 * A ten-character minimum is a bound on *length*, and length is not the thing
 * being defended: `password123` and `qwertyuiop` clear it comfortably and are
 * both in the opening pages of every list a credential-stuffing run works
 * from. This file is the other half of the rule — what the characters actually
 * spell.
 *
 * ## Why a few hundred entries and not ten thousand
 *
 * The published lists — rockyou and its descendants — are overwhelmingly
 * short. Most of what they hold is already refused by `MIN_PASSWORD_LENGTH`,
 * so importing one wholesale would add a hundred kilobytes to restate a check
 * that has already run.
 *
 * What survives ten characters is a much smaller set, and it is a set with a
 * shape: a common word or a keyboard run, plus something on the end to satisfy
 * whatever the last site demanded. So the entries here are *stems*, and
 * `normalizePassword` strips the decoration before comparing — which is how
 * one line, `password`, refuses `password1`, `Password123`, `password!!!` and
 * `p@ssw0rd2026` alike.
 *
 * ## Keeping it honest
 *
 * This is a floor, not a strength meter. It exists to stop the guesses that
 * arrive by the million, and it says nothing kind about a password that passes
 * it. A deployment wanting a longer list can paste one into `COMMON_PASSWORDS`
 * — in normalized form, lowercase letters only — and nothing else here has to
 * change.
 */

/**
 * Leetspeak substitutions, undone before the comparison.
 *
 * Only the ones that are near-universal. Undoing more — `s`→`7`, `t`→`+` —
 * starts folding distinct words onto each other and refusing passwords that
 * are genuinely uncommon.
 */
const LEET: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "@": "a",
  $: "s",
};

/**
 * Reduces a password to the word somebody was thinking of.
 *
 * The order of the two steps is the whole trick, and getting it wrong is
 * silent: undoing the leet first turns the `123` on the end of `password123`
 * into `ie` and leaves `passwordie`, which is in no list and never will be. So
 * the decoration comes off first — the year on the end, the exclamation marks
 * after it, a number typed in front — and only what is left is read as
 * letters somebody spelled oddly.
 *
 * Trailing characters go wholesale, because that is where a site's rules push
 * people. Leading ones only when they are digits: a `@` at the front is `a`,
 * not decoration.
 */
export function normalizePassword(password: string): string {
  const core = password
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z]+$/, "")
    .replace(/^[0-9]+/, "");

  let folded = "";
  for (const character of core) {
    folded += LEET[character] ?? character;
  }
  return folded.replace(/[^a-z]/g, "");
}

/**
 * Stems, in their normalized form — lowercase letters only.
 *
 * An entry with a digit, an accent or a capital in it would be unreachable:
 * `normalizePassword` has removed all three by the time this set is consulted.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  // The perennial top of every list.
  "password",
  "passwort",
  "motdepasse",
  "contrasena",
  "letmein",
  "welcome",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "basketball",
  "superman",
  "batman",
  "spiderman",
  "pokemon",
  "starwars",
  "shadow",
  "master",
  "michael",
  "jennifer",
  "jordan",
  "hunter",
  "harley",
  "ranger",
  "buster",
  "thomas",
  "robert",
  "daniel",
  "charlie",
  "andrew",
  "matthew",
  "joshua",
  "anthony",
  "william",
  "nicole",
  "jessica",
  "ashley",
  "amanda",
  "samantha",
  "elizabeth",
  "chocolate",
  "computer",
  "internet",
  "whatever",
  "freedom",
  "trustno",
  "trustnoone",
  "trustnobody",
  "iloveyou",
  "loveyou",
  "ilovegod",
  "jesuschrist",
  "godislove",
  "soccer",
  "hockey",
  "cowboys",
  "liverpool",
  "arsenal",
  "chelsea",
  "barcelona",
  "realmadrid",
  "juventus",
  "manchester",
  "manutd",

  // Keyboard runs, straight and wrapped, on the three layouts this app ships
  // a language for.
  "qwerty",
  "qwertyu",
  "qwertyui",
  "qwertyuiop",
  "azerty",
  "azertyuiop",
  "qwertz",
  "asdfgh",
  "asdfghjkl",
  "zxcvbn",
  "zxcvbnm",
  "qazwsx",
  "qazwsxedc",
  "wasd",
  "poiuytrewq",
  "lkjhgfdsa",
  "mnbvcxz",
  "qwerasdf",
  "qweasdzxc",
  "adgjmptw",
  "abcdefgh",
  "abcdefghij",
  "abcdefghijk",

  // Words about the thing itself.
  "changeme",
  "changeit",
  "newpassword",
  "mypassword",
  "yourpassword",
  "thepassword",
  "adminadmin",
  "administrator",
  "administrateur",
  "guestguest",
  "rootroot",
  "testtest",
  "testing",
  "temporary",
  "temppassword",
  "defaultpassword",
  "secretsecret",
  "topsecret",
  "supersecret",
  "notapassword",
  "nopassword",
  "forgotpassword",
  "iforgot",
  "idontknow",
  "dontknow",
  "anything",
  "something",
  "nothing",
  "whocares",
  "myaccount",
  "myemail",
  "loginpassword",
  "signinnow",
  "accesscode",
  "openthedoor",
  "opensesame",
  "letmethrough",

  // The knowing ones, which are common precisely because they are knowing.
  "correcthorsebatterystaple",
  "correcthorse",
  "thisisapassword",
  "thisismypassword",
  "averysecurepassword",
  "verysecure",
  "securepassword",
  "strongpassword",
  "longpassword",
  "iamthebest",
  "iamawesome",
  "iamlegend",
  "helloworld",
  "goodpassword",
  "badpassword",
  "notmypassword",
  "guessthis",
  "guessme",
  "youllneverguess",
  "cantguessthis",
  "nobodyknows",

  // Phrases long enough to clear ten characters on their own.
  "iloveyouso",
  "iloveyoutoo",
  "iloveyoumore",
  "iloveyouforever",
  "iloveyoubaby",
  "loveforever",
  "foreverlove",
  "foreveryoung",
  "babygirl",
  "babyboy",
  "sweetheart",
  "beautiful",
  "gorgeous",
  "princesse",
  "myprincess",
  "mysunshine",
  "littleprincess",
  "happyday",
  "happydays",
  "happybirthday",
  "merrychristmas",
  "newyear",
  "goodmorning",
  "goodnight",
  "goodluck",
  "welcometo",
  "welcomehome",
  "welcomeback",
  "letsgo",
  "blahblah",
  "yadayada",
  "asdfasdf",
  "qweqwe",
  "zxczxc",
  "abcabc",

  // Bare words that only reach ten characters with a year on the end, which is
  // exactly the shape `normalizePassword` is built to see through.
  "summer",
  "winter",
  "spring",
  "autumn",
  "january",
  "february",
  "december",
  "monday",
  "friday",
  "sunday",
  "orange",
  "purple",
  "yellow",
  "silver",
  "golden",
  "diamond",
  "phoenix",
  "thunder",
  "lightning",
  "rainbow",
  "butterfly",
  "flower",
  "cheese",
  "coffee",
  "banana",
  "pizza",
  "cookie",
  "chicken",
  "peanut",
  "chocolat",
  "whisky",
  "guinness",
  "corona",
  "ferrari",
  "porsche",
  "mercedes",
  "harleydavidson",
  "nintendo",
  "playstation",
  "minecraft",
  "fortnite",
  "callofduty",
  "worldofwarcraft",
  "runescape",
  "counterstrike",
  "leagueoflegends",
  "metallica",
  "nirvana",
  "beatles",
  "michaeljackson",
  "eminem",
  "rihanna",
  "beyonce",
  "taylorswift",
  "onedirection",
  "justinbieber",
  "harrypotter",
  "lordoftherings",
  "gameofthrones",
  "strangerthings",
  "breakingbad",
  "supernatural",
  "seinfeld",
  "simpsons",
  "familyguy",
  "southpark",
  "naruto",
  "onepiece",
  "dragonball",
  "sailormoon",
  "hellokitty",
  "mickeymouse",
  "disneyland",
  "cinderella",
  "elephant",
  "penguin",
  "dolphin",
  "unicorn",
  "kittycat",
  "puppylove",
  "blackcat",
  "bigdaddy",
  "family",
  "children",
  "grandma",
  "grandpa",
  "brother",
  "sister",
  "mydarling",
  "chouchou",
  "bonjour",
  "salutsalut",
  "jetaime",
  "jetaimemonamour",
  "monamour",
  "moncoeur",
  "soleil",
  "bienvenue",
  "france",
  "paris",
  "marseille",
  "london",
  "newyork",
  "california",
  "montreal",
  "australia",
  "canada",

  // Balancia's own. The demo credential is published in docs/demo.md, and
  // somebody will try it as a real password on the real instance.
  "balancia",
  "balanciapassword",
  "demodemo",
  "demopassword",
]);

/**
 * A password with no word in it at all: one or two characters over and over,
 * or a straight run up or down the keyboard's numbering.
 *
 * Checked on the raw string rather than the normalized one, because `1234…`
 * and `aaaa…` reduce to something the set above could never usefully hold.
 */
function isTrivial(password: string): boolean {
  const lowered = password.normalize("NFKC").toLowerCase();
  if (new Set(lowered).size <= 2) return true;

  /*
   * All digits, whatever the length.
   *
   * Ten digits is thirty-three bits at absolute best, and in practice it is
   * not the best: a password with no letters in it is a birthday, a phone
   * number, a postcode or a run up the keypad, and `normalizePassword` reduces
   * every one of them to nothing, so the list below could never catch them.
   */
  if (/^[0-9]+$/.test(lowered)) return true;

  let ascending = true;
  let descending = true;
  for (let index = 1; index < lowered.length; index += 1) {
    const step = lowered.codePointAt(index)! - lowered.codePointAt(index - 1)!;
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }
  return ascending || descending;
}

/** Whether this is one of the guesses that arrive by the million. */
export function isCommonPassword(password: string): boolean {
  if (isTrivial(password)) return true;

  const normalized = normalizePassword(password);
  if (normalized.length === 0) return false;
  if (COMMON_PASSWORDS.has(normalized)) return true;

  /*
   * The same word typed twice to reach a length requirement.
   * `loveloveloveloves` aside, `lovelovelove` is no harder to guess than
   * `love`, so a stem that is a whole number of repetitions of a shorter one
   * is folded down and the set consulted again.
   */
  for (let size = 1; size <= normalized.length / 2; size += 1) {
    if (normalized.length % size !== 0) continue;
    const unit = normalized.slice(0, size);
    if (unit.repeat(normalized.length / size) !== normalized) continue;
    if (COMMON_PASSWORDS.has(unit)) return true;
  }

  return false;
}

/**
 * Whether the password is made of the account's own details.
 *
 * `ada@balancia.local` choosing `AdaLovelace1` is choosing the one string an
 * attacker who has the address already holds. Only runs of four or more
 * count: refusing a password for containing `anna`'s `anna` is right, and
 * refusing one for containing `li` from `Li` would refuse the dictionary.
 */
export function containsIdentity(
  password: string,
  identity: { readonly email?: string | null; readonly name?: string | null },
): boolean {
  const haystack = normalizePassword(password);
  if (haystack.length === 0) return false;

  const localPart = identity.email?.split("@")[0] ?? "";
  const needles = [localPart, ...(identity.name ?? "").split(/\s+/)]
    .map((part) => normalizePassword(part))
    .filter((part) => part.length >= 4);

  return needles.some((needle) => haystack.includes(needle));
}
