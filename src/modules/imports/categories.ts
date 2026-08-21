import {
  FALLBACK_CATEGORY,
  classifyTransactionSync,
  isExpenseCategory,
  isValidSubcategory,
  normalizeLegacyCategory,
  type ExpenseCategory,
  type ExpenseSubcategory,
  type LearnedMerchantMapping,
} from "@/modules/categorization";
import type { StagedExpense } from "./types";

/**
 * Categorizing what an import brought in.
 *
 * A Splitwise row arrives with the label *its* app used — "Dining out",
 * "Fournitures ménagères", "Bus/train". Written into `expenses.category` as
 * it stands, that label is not a code: it gets its own bucket in the spread,
 * no icon, and no rule will ever match it again. A year of history imports as
 * a legend of one-off strings.
 *
 * So a row is categorized in four steps, most trustworthy first:
 *
 *  1. **The source's own leaf.** Splitwise's category list is fixed and
 *     public, so translating "Dining out" is a lookup, not a guess.
 *  2. **The classifier**, over the description — the same rules, and the same
 *     learned mappings, that a typed expense goes through. Only an
 *     `auto_assigned` answer is taken: an import is unattended, so anything
 *     the form would have *asked* about is not something to decide alone.
 *  3. **The source's group**, if the row carried one instead of a leaf.
 *     "Transportation" covers taxis, flights and hotel nights, so it is worth
 *     less than a description that named one of them — which is why it is
 *     consulted here and not in step 1.
 *  4. **The label, kept as it was.** Unrecognised is not the same as absent,
 *     and throwing the source's own word away would lose the only thing the
 *     row said about itself.
 *
 * A source leaf that is precise enough carries a subcategory across as well.
 * Splitwise's "Electricity" is not merely `home`, it is `home / electricity`,
 * and dropping the second half would throw away something the file actually
 * said. Its vaguer leaves map to the category alone — "Services" is upkeep of
 * some kind, and which kind is exactly what the row does not say.
 *
 * Nothing here writes a learned mapping. An imported label is somebody else's
 * classification of a merchant this group may never have chosen a category
 * for — `recordCategoryChoice` deliberately ignores free text, and an import
 * must not teach through the back door.
 */

/** Folds case, accents and separators so one spelling matches the file's. */
function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Splitwise's leaves, in the languages it exports.
 *
 * Keys are normalized, so "Frais médicaux", "frais medicaux" and
 * "FRAIS MEDICAUX" are one entry.
 *
 * Two placements are choices rather than translations, and are made here so
 * they are visible:
 *
 *  - **Insurance** is left out on purpose. Balancia has no insurance code, and
 *    which one is right depends on the policy — the description says
 *    "assurance ménage" or "assurance maladie" and the classifier reads it.
 *  - **Taxes** goes to `fees`, the money-that-buys-nothing bucket. It is not a
 *    bank charge, but it is nearer that than any other code, and the
 *    alternative is a "Taxes" string that no rule and no icon ever reaches.
 */
/** A category, and the subcategory the source was precise enough to imply. */
export interface CategoryAssignment {
  readonly category: ExpenseCategory;
  readonly subcategory: ExpenseSubcategory | null;
}

/** Spelt as a tuple in the tables below, for one line per label. */
type Assignment =
  ExpenseCategory | readonly [ExpenseCategory, ExpenseSubcategory];

const SOURCE_CATEGORIES: Readonly<Record<string, Assignment>> = {
  // Food and drink
  groceries: ["groceries", "supermarket"],
  courses: ["groceries", "supermarket"],
  "dining out": ["restaurants", "restaurant"],
  restaurant: ["restaurants", "restaurant"],
  "sortie au restaurant": ["restaurants", "restaurant"],
  liquor: ["restaurants", "bar"],
  alcool: ["restaurants", "bar"],

  // Entertainment
  games: ["entertainment", "games"],
  jeux: ["entertainment", "games"],
  movies: ["entertainment", "cinema"],
  films: ["entertainment", "cinema"],
  music: ["entertainment", "music"],
  musique: ["entertainment", "music"],
  sports: ["activities", "sports"],

  // Home
  rent: ["home", "rent"],
  loyer: ["home", "rent"],
  mortgage: ["home", "mortgage"],
  "pret immobilier": ["home", "mortgage"],
  furniture: ["home", "furniture"],
  meubles: ["home", "furniture"],
  "household supplies": ["home", "household_supplies"],
  "fournitures menageres": ["home", "household_supplies"],
  maintenance: ["home", "maintenance"],
  entretien: ["home", "maintenance"],
  // "Services" is upkeep of an unstated kind — a gardener, a plumber, a
  // cleaner. The category is safe; naming one of them would not be.
  services: "home",
  electronics: ["shopping", "electronics"],
  electronique: ["shopping", "electronics"],
  pets: "pets",
  animaux: "pets",

  // Life
  childcare: ["kids_family", "childcare"],
  "garde d enfants": ["kids_family", "childcare"],
  education: ["kids_family", "school"],
  clothing: ["shopping", "clothing"],
  vetements: ["shopping", "clothing"],
  gifts: ["gifts", "gifts"],
  cadeaux: ["gifts", "gifts"],
  "medical expenses": "health",
  "frais medicaux": "health",
  taxes: ["fees", "taxes"],
  impots: ["fees", "taxes"],

  // Transportation
  bicycle: ["transport", "bike_scooter"],
  velo: ["transport", "bike_scooter"],
  "bus train": ["transport", "public_transport"],
  // "Car" is fuel, servicing, a hire or a toll — the row does not say which.
  car: "transport",
  voiture: "transport",
  "gas fuel": ["transport", "fuel"],
  "essence carburant": ["transport", "fuel"],
  parking: ["transport", "parking"],
  taxi: ["transport", "taxi_ride_hailing"],
  plane: ["transport", "flights"],
  avion: ["transport", "flights"],
  hotel: ["lodging", "hotel"],

  // Utilities — all of them `home` now, and each precise about which bill.
  electricity: ["home", "electricity"],
  electricite: ["home", "electricity"],
  "heat gas": ["home", "heating"],
  "chauffage gaz": ["home", "heating"],
  "tv phone internet": ["home", "internet"],
  "tv telephone internet": ["home", "internet"],
  // Refuse collection is a charge on the home with no bill of its own here.
  trash: "home",
  poubelles: "home",
  water: ["home", "water"],
  eau: ["home", "water"],
  cleaning: ["home", "cleaning_service"],
  nettoyage: ["home", "cleaning_service"],
};

/**
 * The groups those leaves hang under, for exports that write the section
 * rather than the leaf.
 *
 * A group is a weaker witness than a description, because its leaves scatter:
 * Splitwise files hotels and flights under Transportation, and a museum entry
 * under Entertainment. Only groups that lean one way are here at all —
 * "Food and drink" is half a supermarket and half a restaurant, and "Life"
 * runs from childcare to taxes, so neither can be reduced to a code.
 */
const COARSE_CATEGORIES: Readonly<Record<string, ExpenseCategory>> = {
  transportation: "transport",
  transports: "transport",
  entertainment: "entertainment",
  divertissement: "entertainment",
  utilities: "home",
  "services publics": "home",
  home: "home",
  maison: "home",
};

/**
 * Labels that mean "nobody filed this", in the languages exports come in.
 *
 * These are not categories that failed to translate — they are the source
 * saying it has none. Keeping one as free text would put a "Général" slice on
 * the spread for the rows that were never categorized at all, which is the
 * opposite of what the label says.
 *
 * Our own `other` belongs here too when it arrives from an import: as a leaf
 * of somebody else's tree it means "something else under Home", not the
 * deliberate choice ours records.
 */
const UNINFORMATIVE_LABELS: ReadonlySet<string> = new Set([
  FALLBACK_CATEGORY,
  "general",
  "uncategorized",
  "uncategorised",
  "no category",
  "none",
  "other",
  "autre",
  "autres",
  "divers",
  "non categorise",
  "sans categorie",
  "aucune",
]);

/**
 * A table lookup that only ever finds what was written in the table.
 *
 * Labels come out of a file, and a plain `table[label]` answers for
 * `constructor` and `toString` as well — with a function, not a category.
 */
function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | null {
  return Object.hasOwn(table, key) ? table[key] : null;
}

/** Widens a table entry into the pair the rest of the file passes around. */
function assign(entry: Assignment): CategoryAssignment {
  return typeof entry === "string"
    ? { category: entry, subcategory: null }
    : { category: entry[0], subcategory: entry[1] };
}

/**
 * The Balancia code a source's own category label means, or null.
 *
 * A label that is already one of our codes passes straight through, so a file
 * that went out of Balancia comes back in as itself — `other` excepted, for
 * the reason given above.
 */
export function sourceCategory(
  label: string | null | undefined,
): CategoryAssignment | null {
  if (!label) return null;
  // Already one of our codes, spelled exactly as we spell it: it came from a
  // Balancia export, so it is a decision this app already made rather than a
  // label to interpret. Checked before anything else — a restore that let the
  // classifier re-read the description could hand back a different category
  // than the one it was given.
  if (isExpenseCategory(label)) return { category: label, subcategory: null };
  // A Balancia export written before the taxonomy changed still says
  // `housing` or `family`. It is our own code, just an old one, so it is
  // translated rather than read as somebody else's label.
  const legacy = normalizeLegacyCategory(label);
  if (legacy) return { category: legacy, subcategory: null };
  const normalized = normalizeLabel(label);
  if (normalized === "" || UNINFORMATIVE_LABELS.has(normalized)) return null;
  // "Entertainment" and "Utilities" are group names in Splitwise's tree *and*
  // codes in ours. Spelling the same does not make them the same claim, so the
  // group reading wins: they wait behind the description, with the rest of the
  // groups, rather than passing through as decided.
  if (lookup(COARSE_CATEGORIES, normalized)) return null;
  // The leaf table is consulted before the "it normalizes to one of our codes"
  // reading, because it is strictly more precise about the same answer.
  // Splitwise's "Groceries" and ours are the same category either way — but
  // its leaf also says *supermarket*, and taking the shortcut would throw that
  // away for the three labels whose spelling happens to collide with a code.
  const entry = lookup(SOURCE_CATEGORIES, normalized);
  if (entry !== null) return assign(entry);
  if (isExpenseCategory(normalized)) {
    return { category: normalized, subcategory: null };
  }
  return null;
}

/**
 * What to store in `category` and `subcategory` for an imported row.
 *
 * Returns a canonical code where one can be established, the source's own
 * label where it cannot, and null where there was nothing to go on. A free
 * text label never carries a subcategory — nothing can legitimately sit under
 * something that is not a category.
 */
export function categorizeImportedExpense(
  staged: StagedExpense,
  options: { mappings?: readonly LearnedMerchantMapping[] } = {},
): { category: string | null; subcategory: string | null } {
  const fromSource = sourceCategory(staged.category);
  if (fromSource) {
    // A Balancia backup carries the pair the user actually chose. It wins over
    // whatever the label table would have inferred — restoring your own export
    // must give you back your own answer, not a fresh reading of it. Anything
    // that does not belong under the resolved category is dropped: a backup
    // written before `housing` became `home` may well name a child that has no
    // meaning under the code it migrated to.
    if (isValidSubcategory(fromSource.category, staged.subcategory)) {
      return {
        category: fromSource.category,
        subcategory: staged.subcategory || fromSource.subcategory,
      };
    }
    return fromSource;
  }

  const classified = classifyTransactionSync(
    {
      // Imports have no merchant field of their own: the description is what
      // the payer typed, and it is both name and explanation.
      merchant: staged.description,
      description: staged.description,
      note: staged.notes ?? undefined,
    },
    { mappings: options.mappings },
  );
  if (classified.decision === "auto_assigned" && classified.category) {
    // The subcategory rides in on the same rule that named the category, and
    // only when it is one this category allows.
    const subcategory = isValidSubcategory(
      classified.category,
      classified.subcategory,
    )
      ? (classified.subcategory ?? null)
      : null;
    return { category: classified.category, subcategory };
  }

  const label = staged.category?.trim();
  if (!label) return { category: null, subcategory: null };

  const normalized = normalizeLabel(label);
  if (UNINFORMATIVE_LABELS.has(normalized)) {
    return { category: null, subcategory: null };
  }
  return {
    category: lookup(COARSE_CATEGORIES, normalized) ?? label,
    subcategory: null,
  };
}
