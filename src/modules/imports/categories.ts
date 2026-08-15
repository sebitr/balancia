import {
  FALLBACK_CATEGORY,
  classifyTransactionSync,
  isExpenseCategory,
  type ExpenseCategory,
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
const SOURCE_CATEGORIES: Readonly<Record<string, ExpenseCategory>> = {
  // Food and drink
  groceries: "groceries",
  courses: "groceries",
  "dining out": "restaurants",
  restaurant: "restaurants",
  "sortie au restaurant": "restaurants",
  liquor: "restaurants",
  alcool: "restaurants",

  // Entertainment
  games: "entertainment",
  jeux: "entertainment",
  movies: "entertainment",
  films: "entertainment",
  music: "entertainment",
  musique: "entertainment",
  sports: "activities",

  // Home
  rent: "housing",
  loyer: "housing",
  mortgage: "housing",
  "pret immobilier": "housing",
  furniture: "household",
  meubles: "household",
  "household supplies": "household",
  "fournitures menageres": "household",
  maintenance: "household",
  entretien: "household",
  services: "household",
  electronics: "shopping",
  electronique: "shopping",
  pets: "pets",
  animaux: "pets",

  // Life
  childcare: "family",
  "garde d enfants": "family",
  education: "family",
  clothing: "shopping",
  vetements: "shopping",
  gifts: "gifts",
  cadeaux: "gifts",
  "medical expenses": "health",
  "frais medicaux": "health",
  taxes: "fees",
  impots: "fees",

  // Transportation
  bicycle: "transport",
  velo: "transport",
  "bus train": "transport",
  car: "transport",
  voiture: "transport",
  "gas fuel": "transport",
  "essence carburant": "transport",
  parking: "transport",
  taxi: "transport",
  plane: "travel",
  avion: "travel",
  hotel: "lodging",

  // Utilities
  electricity: "utilities",
  electricite: "utilities",
  "heat gas": "utilities",
  "chauffage gaz": "utilities",
  "tv phone internet": "utilities",
  "tv telephone internet": "utilities",
  trash: "utilities",
  poubelles: "utilities",
  water: "utilities",
  eau: "utilities",
  cleaning: "household",
  nettoyage: "household",
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
  utilities: "utilities",
  "services publics": "utilities",
  home: "household",
  maison: "household",
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
function lookup(
  table: Readonly<Record<string, ExpenseCategory>>,
  key: string,
): ExpenseCategory | null {
  return Object.hasOwn(table, key) ? table[key] : null;
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
): ExpenseCategory | null {
  if (!label) return null;
  const normalized = normalizeLabel(label);
  if (normalized === "" || UNINFORMATIVE_LABELS.has(normalized)) return null;
  // "Entertainment" and "Utilities" are group names in Splitwise's tree *and*
  // codes in ours. Spelling the same does not make them the same claim, so the
  // group reading wins: they wait behind the description, with the rest of the
  // groups, rather than passing through as decided.
  if (lookup(COARSE_CATEGORIES, normalized)) return null;
  if (isExpenseCategory(normalized)) return normalized;
  return lookup(SOURCE_CATEGORIES, normalized);
}

/**
 * What to store in `expenses.category` for an imported row.
 *
 * Returns a canonical code where one can be established, the source's own
 * label where it cannot, and null where there was nothing to go on.
 */
export function categorizeImportedExpense(
  staged: StagedExpense,
  options: { mappings?: readonly LearnedMerchantMapping[] } = {},
): string | null {
  const fromSource = sourceCategory(staged.category);
  if (fromSource) return fromSource;

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
    return classified.category;
  }

  const label = staged.category?.trim();
  if (!label) return null;

  const normalized = normalizeLabel(label);
  if (UNINFORMATIVE_LABELS.has(normalized)) return null;
  return lookup(COARSE_CATEGORIES, normalized) ?? label;
}
