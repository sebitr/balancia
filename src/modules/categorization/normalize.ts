/**
 * Merchant normalization.
 *
 * Bank and card descriptors are noisy: `CB CARREFOUR MARKET PARIS 12/05 CARTE
 * 1234`. Matching against that directly is hopeless, so every rule and every
 * input is put through this one pipeline and compared in normalized space.
 * The original text is never modified — `rawMerchant` is what the user sees,
 * `normalizedMerchant` is only ever used for matching.
 *
 * Two deliberate limits:
 *
 *  - Digit groups are *kept*, not stripped. `MICROSOFT 365` and `INIT7` mean
 *    the digits, while `MIGROS 1234` does not; the matcher decides which is
 *    which (see `isNoiseToken`) instead of the normalizer guessing.
 *  - Only structured noise is removed — dates, card masks, authorization
 *    codes, long identifiers — because those cannot be part of a name.
 */

/** Case, accents and whitespace folded away; punctuation kept for now. */
export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Folded text split into alphanumeric tokens.
 *
 * Tokens are the unit every matcher works in, so `netflix.com`, `NETFLIX COM`
 * and `Netflix.com/bill` all reduce to comparable sequences and a rule can
 * never match half a word (`rent` inside `rental`).
 */
export function tokenize(value: string): string[] {
  const folded = foldText(value);
  const tokens = folded.match(/[a-z0-9]+/g);
  return tokens ?? [];
}

/**
 * A token with its plural marker taken off, for comparing *words* only.
 *
 * `pizzas` and `pizza` are the same purchase, and before this every plural had
 * to be written into the seed data beside its singular — which is how `Pizza`
 * was recognised and `Pizzas` was not. A rule file cannot be the place a
 * language's morphology is enumerated by hand.
 *
 * Deliberately not a stemmer. It removes one trailing `s` or `x` and nothing
 * else: no suffix tables, no vowel rules, no irregulars. `chevaux` will not
 * find `cheval`, and that is the right trade — the failure of an
 * over-eager stemmer is a wrong category, which costs more than a miss.
 *
 * Three guards keep it from inventing matches:
 *
 *  - Both sides are folded identically, so this can only ever merge words, and
 *    a merge is harmless unless two *different* words collapse together.
 *  - A word ending in `ss` keeps it. `pass` must not become `pas`, which is one
 *    of the commonest words in French and would match half the sentences typed
 *    into the form.
 *  - Short words are left alone, because that is where collisions live: `bus`
 *    is not a plural of `bu`, and `jus` is not a plural of `ju`.
 *
 * Never applied to merchants. `normalizeMerchant` builds the string that
 * becomes a learned mapping's stored key, so folding there would change the
 * key of every mapping already in every database — `migros` would look up
 * `migro` and a household's history would silently stop matching.
 */
export function singularize(token: string): string {
  if (token.length >= 5 && token.endsWith("x")) return token.slice(0, -1);
  if (token.length >= 4 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

/** Payment processors that front for the merchant who actually got paid. */
const PROCESSOR_PATTERN =
  /\b(paypal|sq|sumup|stripe|sq \*|zettle|izettle)\s*\*\s*/;

const PROCESSOR_NAMES = new Set([
  "paypal",
  "sq",
  "square",
  "sumup",
  "stripe",
  "zettle",
  "izettle",
]);

/** Card-network and payment-instrument words that precede the real name. */
const LEADING_PREFIXES = new Set([
  "cb",
  "carte",
  "card",
  "debit",
  "credit",
  "visa",
  "mastercard",
  "maestro",
  "pos",
  "purchase",
  "paiement",
  "achat",
  "payment",
  "vpay",
  "ec",
]);

/**
 * Words after which a leading `carte` is a noun and not a card marker.
 *
 * "Carte" opens a payment descriptor ("CARTE 1234", "CARTE VISA") and it also
 * opens several ordinary French terms, and stripping it from those deleted the
 * only word that identified them: `carte grise` became `grise`, so the vehicle
 * registration rule that has always been in the seed data could never fire,
 * and `carte journalière` lost the day pass the same way.
 *
 * Kept as an explicit list rather than a rule about what follows, because the
 * general shape does not hold: `CB CARREFOUR` is a card word in front of a
 * merchant and must still be stripped, and so is `CARTE DE CREDIT`.
 */
const CARD_COMPOUND_HEADS = new Set(["grise", "cadeau", "journaliere"]);

/**
 * Structured noise: nothing here can be part of a merchant name, and none of
 * it should reach a log, a model or an embedding.
 *
 * Case-insensitive so the same list serves both the folded text used for
 * matching and the original text used for semantic input.
 */
const NOISE_PATTERNS: readonly RegExp[] = [
  // Dates: 12/05/2024, 2024-05-12, 12.05.24, 12-05
  /\b\d{4}-\d{2}-\d{2}\b/gi,
  /\b\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?\b/gi,
  // Times: 14:32, 14h32
  /\b\d{1,2}[:h]\d{2}\b/gi,
  // Masked card numbers: xxxx1234, ****1234, x-1234
  /\b[x*]{2,}[\s-]?\d{2,4}\b/gi,
  // UUIDs, which are ours and never the user's words.
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  // Explicitly labelled identifiers: `AUTH 998877`, `REF12345`, `no. 4471`.
  //
  // The label has to be followed by either a separator or something that looks
  // like an identifier — meaning it contains a digit. Allowing neither made
  // the label match the first syllable of an ordinary word, and the rest of
  // the word became the identifier: `Novotel` was `no` + `votel` and
  // normalized to nothing at all. So did Nordsee, Notion, Nomad, Nocibé and
  // `refuge`, which is a lodging rule this file ships and could never match.
  /\b(auth|autorisation|authorization|approval|ref|reference|trn|txn|tran|id|no|nr|num|numero|terminal|term|tid|mid)\.?(?:[\s:#-]+[a-z0-9]{3,}|(?=[a-z0-9]*\d)[a-z0-9]{3,})\b/gi,
  // Long identifiers: 6+ digits, or 8+ mixed alphanumerics containing a digit.
  /\b\d{6,}\b/gi,
  /\b(?=[a-z0-9]*\d)[a-z0-9]{8,}\b/gi,
  // Card-holder trailing four, e.g. "carte 1234" once the word is gone.
  /\b(kaart|carte|card)\s*\d{2,4}\b/gi,
];

/**
 * Removes identifiers without touching the words around them.
 *
 * Used for the semantic input, which must keep its accents and its case: a
 * multilingual sentence model is precisely the thing that knows `dîner` and
 * `dinner` are the same idea, and folding the accent away throws that help
 * back in its face.
 */
export function stripStructuredNoise(value: string): string {
  let text = value;
  for (const pattern of NOISE_PATTERNS) {
    text = text.replace(pattern, " ");
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * City and country tokens that trail an acquirer's descriptor. Stripped only
 * from the end, and never down to nothing — `SIG GENEVE` and the seed rule
 * `sig geneve` both reduce to `sig`, so consistency comes for free.
 *
 * Country *names* are deliberately absent: `swiss airlines` and `aldi suisse`
 * are merchant names, not locations.
 */
const TRAILING_PLACES = new Set([
  "geneve",
  "geneva",
  "genf",
  "lausanne",
  "zurich",
  "zuerich",
  "bern",
  "berne",
  "basel",
  "bale",
  "lugano",
  "sion",
  "fribourg",
  "neuchatel",
  "vevey",
  "montreux",
  "nyon",
  "morges",
  "yverdon",
  "carouge",
  "meyrin",
  "versoix",
  "paris",
  "lyon",
  "marseille",
  "toulouse",
  "bordeaux",
  "lille",
  "nantes",
  "strasbourg",
  "montpellier",
  "nice",
  "rennes",
  "grenoble",
  "annecy",
  "chamonix",
  "london",
  "milano",
  "roma",
  "berlin",
  "madrid",
  "barcelona",
  "amsterdam",
  "bruxelles",
  "brussels",
  "che",
  "fra",
  "gbr",
  "usa",
  "deu",
  "ita",
  "esp",
  "bel",
  "nld",
]);

export interface NormalizedMerchant {
  /** Exactly what the caller passed, untouched. */
  readonly rawMerchant: string;
  /** Folded, de-noised, prefix-free text used to identify the *merchant*. */
  readonly normalizedMerchant: string;
  /**
   * The same, with the leading payment words left on, for matching *words*.
   *
   * Stripping `achat`, `carte`, `credit` and the rest is right for a merchant:
   * it is what makes `CB CARREFOUR 12/05` and `carrefour` the same key, and
   * that key is what a learned mapping is stored under. It is wrong for a
   * description, because those words also open ordinary phrases, and the
   * stripping deleted the half that identified them — `achat de voiture` came
   * through as `de voiture`, `visa application` as `application`, and every
   * seed rule written that way was unreachable however plainly someone typed
   * it.
   *
   * Keeping them is safe in the direction that matters: a phrase that matched
   * the shorter form still matches this one, so this can only ever add
   * evidence. `merchantTokens` stays on `normalizedMerchant`, so brand
   * matching and mapping keys are untouched.
   */
  readonly withLeadingWords: string;
  /** The processor that fronted the payment, when one was recognised. */
  readonly processor: string | null;
  /** True when the text was *only* a processor, with no merchant behind it. */
  readonly processorOnly: boolean;
}

/**
 * Reduces a descriptor to the merchant behind it.
 *
 * `PAYPAL *SPOTIFY` becomes `spotify` with `processor: "paypal"`: the
 * processor is remembered so it can be reported, but it is never itself a
 * category signal.
 */
export function normalizeMerchant(
  raw: string | null | undefined,
): NormalizedMerchant {
  const rawMerchant = raw ?? "";
  let text = foldText(rawMerchant);
  let processor: string | null = null;

  const processorMatch = PROCESSOR_PATTERN.exec(text);
  if (processorMatch) {
    processor = processorMatch[1] === "sq" ? "square" : processorMatch[1];
    text = text.slice(processorMatch.index + processorMatch[0].length).trim();
  }

  for (const pattern of NOISE_PATTERNS) {
    text = text.replace(pattern, " ");
  }

  let tokens = tokenize(text);

  // Leading payment words, however many are stacked ("paiement cb visa").
  let start = 0;
  while (start < tokens.length && LEADING_PREFIXES.has(tokens[start])) {
    if (
      tokens[start] === "carte" &&
      CARD_COMPOUND_HEADS.has(tokens[start + 1] ?? "")
    ) {
      break;
    }
    start += 1;
  }
  const leadingWords = tokens.slice(0, start);
  tokens = tokens.slice(start);

  // A processor named without a separator ("paypal europe") is still just the
  // processor: strip it, and remember that nothing identifiable is left.
  while (tokens.length > 0 && PROCESSOR_NAMES.has(tokens[0])) {
    processor ??= tokens[0] === "sq" ? "square" : tokens[0];
    tokens = tokens.slice(1);
  }

  while (tokens.length > 1 && TRAILING_PLACES.has(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }

  const normalizedMerchant = tokens.join(" ");
  return {
    rawMerchant,
    normalizedMerchant,
    withLeadingWords: [...leadingWords, ...tokens].join(" "),
    processor,
    processorOnly: processor !== null && normalizedMerchant === "",
  };
}

/**
 * Tokens that carry no identity: store numbers, two-letter legal forms,
 * leftover place names. They are what lets `migros 1234` and `uber bv` still
 * match the single-word rules `migros` and `uber`.
 */
export function isNoiseToken(token: string): boolean {
  return /^\d+$/.test(token) || token.length <= 3 || TRAILING_PLACES.has(token);
}

/**
 * The key a merchant is *learned* under.
 *
 * Store numbers change between visits — `MIGROS 1234` and `MIGROS 5678` are
 * the same shop — so what is remembered is the identity left once the noise
 * is dropped. A descriptor that is nothing but noise keeps its whole
 * normalized form rather than becoming an empty key.
 */
export function merchantKey(normalizedMerchant: string): string {
  const tokens = tokenize(normalizedMerchant);
  const identifying = tokens.filter((token) => !isNoiseToken(token));
  return (identifying.length > 0 ? identifying : tokens).join(" ");
}

/** True when `needle` appears as a run of whole tokens inside `haystack`. */
export function containsTokenRun(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
  return indexOfTokenRun(haystack, needle) !== -1;
}

/** Position of `needle` inside `haystack`, in tokens, or -1. */
export function indexOfTokenRun(
  haystack: readonly string[],
  needle: readonly string[],
): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * True when `needle` opens `haystack` and everything after it is noise.
 *
 * This is the test that makes single-word merchant rules safe. `migros 1234`
 * is Migros; `max s birthday dinner` is not the streaming service, because
 * `birthday` and `dinner` are real words that the rule does not explain.
 */
export function isIdentifyingPrefix(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
  if (indexOfTokenRun(haystack, needle) !== 0) return false;
  return haystack.slice(needle.length).every(isNoiseToken);
}
