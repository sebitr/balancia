import type { PhrasesByLanguage } from "./seeds";
import type { IncomeCategory, IncomeSubcategoryOf } from "./income-taxonomy";

/**
 * Global income seed rules.
 *
 * The income half of `seeds.ts`, and it is far smaller for a reason worth
 * stating: spending is identified by *who you paid* — a merchant, a brand, a
 * trade — and money coming in has no merchant. `MIGROS` names a category on
 * its own; a credit transfer of 1'450.00 does not. So this file is almost
 * entirely phrases, and the phrases are the words people actually type into
 * the description field: `loyer août`, `deposit back`, `salaire`.
 *
 * The one place brands do work is `sales`, and only because direction already
 * disambiguates them. `vinted` on an outgoing entry is shopping; on an
 * incoming one it can only be a sale. That is the whole benefit of two
 * vocabularies over one — a rule here never has to defend itself against the
 * expense reading, because the expense table is not consulted.
 *
 * The rules from `seeds.ts` all still hold:
 *
 *  - **Write the singular; the plural comes free.** Matching is on
 *    singularised tokens.
 *  - **A word in two categories is a tie, not a hint.** Two categories
 *    claiming `remboursement` cancel out and the field is left blank, which
 *    is the right outcome when the word genuinely does not decide.
 *  - **A subcategory is only asserted when something named it outright.**
 *    Knowing money is `refunds` says nothing about which of its five leaves,
 *    and a plausible guess filed under the user's name is worse than the
 *    blank it replaced.
 *
 * One deliberate omission. `benefits / insurance_payout` and
 * `refunds / insurance_claim` are the same event seen from two sides, and the
 * handoff taxonomy carries both. Only `refunds` claims the words for it —
 * *sinistre*, *insurance claim* — because that is the commoner reading and
 * because giving both categories the phrase would make them cancel. The
 * `benefits` leaf stays pickable by hand; it is simply never detected.
 */

/** A rule that refines a settled income category into one of its leaves. */
export interface IncomeSubcategorySeed<
  C extends IncomeCategory = IncomeCategory,
> {
  readonly id: IncomeSubcategoryOf<C>;
  /** Brands, matched against the normalized merchant only. */
  readonly merchants?: readonly string[];
  /** The receipt said outright, in any language the file covers. */
  readonly phrases?: PhrasesByLanguage;
}

export interface IncomeCategorySeed {
  readonly id: IncomeCategory;
  readonly strongPhrases: PhrasesByLanguage;
  readonly weakKeywords?: PhrasesByLanguage;
  readonly merchants?: readonly string[];
  readonly merchantFragments?: readonly string[];
  readonly ambiguousMerchants?: readonly string[];
  readonly excludes?: readonly string[];
  readonly subcategories?: readonly IncomeSubcategorySeed[];
}

export const INCOME_CATEGORY_SEEDS: readonly IncomeCategorySeed[] = [
  {
    /**
     * The reason the income type exists.
     *
     * `excludes` carries the one confusion that matters: a household that
     * *pays* rent and a household that *receives* it both write "rent", and
     * only the second is this category. Direction already separates them, so
     * the excludes here are narrower — they catch an incoming entry that is
     * plainly about a rent the group owes, such as a landlord refunding an
     * overcharge, which is `refunds`.
     */
    id: "rent",
    /*
     * The bare word is strong here and weak in `seeds.ts`, and that is the
     * dividend the second vocabulary pays. On an expense, "loyer" competes
     * with the twenty-four other things `home` covers; on an income there is
     * nothing for it to compete with. `excludes` still takes it back when the
     * sentence turns out to be about a refund or a deposit.
     */
    strongPhrases: {
      en: [
        "rent",
        "rent received",
        "rent from",
        "rent paid to us",
        "tenant rent",
        "lodger",
        "room rent",
        "flatmate rent",
        "housemate rent",
        "roommate rent",
        "rental income",
      ],
      fr: [
        "loyer recu",
        "loyer du locataire",
        "loyer locataire",
        "revenu locatif",
        "part de loyer",
        "loyer colocataire",
        "loyer",
      ],
    },
    weakKeywords: {
      en: ["tenant", "lease"],
      fr: ["locataire", "bail"],
    },
    excludes: ["refund", "remboursement", "deposit", "caution"],
    subcategories: [
      {
        id: "monthly_rent",
        phrases: {
          en: ["monthly rent", "month rent", "rent for"],
          fr: ["loyer mensuel", "loyer du mois", "loyer de"],
        },
      },
      {
        id: "parking",
        phrases: {
          en: ["parking space", "garage rental", "parking rent"],
          fr: ["place de parc", "place de parking", "location garage"],
        },
      },
      {
        id: "storage",
        phrases: {
          en: ["storage rent", "cellar", "storage unit"],
          fr: ["cave", "depot", "box de rangement"],
        },
      },
      {
        id: "utilities_share",
        phrases: {
          en: ["utilities share", "share of the bills", "bills share"],
          fr: ["part des charges", "charges locatives", "nebenkosten"],
        },
      },
      {
        id: "short_stay",
        merchants: ["airbnb", "booking com", "vrbo"],
        phrases: {
          en: ["short stay", "airbnb payout", "guest stay", "nightly rental"],
          fr: [
            "location courte duree",
            "versement airbnb",
            "nuitee",
            "location saisonniere",
          ],
        },
      },
      {
        id: "sublet",
        phrases: {
          en: ["sublet", "subletting", "sublease"],
          fr: ["sous location", "sous loue"],
        },
      },
    ],
  },
  {
    id: "refunds",
    strongPhrases: {
      en: [
        "refund",
        "refunded",
        "money back",
        "chargeback",
        "credit note",
        "returned item",
        "reimbursement",
        "reimbursed",
      ],
      fr: [
        "remboursement",
        "rembourse",
        "avoir",
        "note de credit",
        "retrofacturation",
        "restitution",
      ],
    },
    weakKeywords: {
      en: ["return", "credit"],
      fr: ["retour", "credit"],
    },
    subcategories: [
      {
        id: "purchase_return",
        phrases: {
          en: ["purchase return", "returned item", "product return"],
          fr: ["retour d achat", "retour article", "retour produit"],
        },
      },
      {
        id: "cancelled_booking",
        phrases: {
          en: [
            "cancelled booking",
            "cancellation refund",
            "booking cancelled",
            "trip cancelled",
          ],
          fr: [
            "reservation annulee",
            "annulation",
            "remboursement annulation",
            "voyage annule",
          ],
        },
      },
      {
        id: "insurance_claim",
        phrases: {
          en: ["insurance claim", "claim payout", "claim settled"],
          fr: ["sinistre", "declaration de sinistre", "indemnisation"],
        },
      },
      {
        id: "overpayment",
        phrases: {
          en: ["overpayment", "overpaid", "overcharge refund", "overcharged"],
          fr: ["trop paye", "trop percu", "surfacturation"],
        },
      },
      {
        id: "tax_refund",
        phrases: {
          en: ["tax refund", "tax return", "vat refund", "tax rebate"],
          fr: [
            "remboursement d impot",
            "impot rembourse",
            "remboursement tva",
            "declaration fiscale",
          ],
        },
      },
    ],
  },
  {
    /**
     * Money that was never spending coming back.
     *
     * Kept apart from `refunds` because groups ask about it separately — "did
     * we get the flat deposit back" has a date and an amount attached, and it
     * stops being answerable once it is one row among the purchase returns.
     */
    id: "deposits",
    strongPhrases: {
      en: [
        "deposit",
        "deposit returned",
        "deposit refund",
        "deposit back",
        "security deposit",
        "bond returned",
        "damage deposit",
      ],
      fr: [
        "caution rendue",
        "caution restituee",
        "restitution de la caution",
        "depot de garantie",
        "caution remboursee",
        // Strong for the same reason `loyer` is: on money coming in, a
        // deposit can only be one that came back.
        "caution",
      ],
    },
    weakKeywords: {
      en: ["bond"],
      fr: ["garantie"],
    },
    subcategories: [
      {
        id: "rental_deposit",
        phrases: {
          en: ["rental deposit", "flat deposit", "tenancy deposit"],
          fr: ["caution de location", "caution du bail", "caution appartement"],
        },
      },
      {
        id: "utility_deposit",
        phrases: {
          en: ["utility deposit", "meter deposit"],
          fr: ["depot de garantie", "caution compteur"],
        },
      },
      {
        id: "key_deposit",
        phrases: {
          en: ["key deposit", "badge deposit"],
          fr: ["caution de cle", "caution badge"],
        },
      },
    ],
  },
  {
    /**
     * The only income that comes from inside the group.
     *
     * Without it the kitty gets filed as a refund and the group's own float
     * looks like money the world gave them.
     */
    id: "contributions",
    strongPhrases: {
      en: [
        "group fund",
        "kitty",
        "whip round",
        "chip in",
        "chipped in",
        "membership dues",
        "float",
      ],
      fr: [
        "caisse commune",
        "cagnotte",
        "participation",
        "cotisation",
        "mise en commun",
      ],
    },
    weakKeywords: {
      en: ["contribution", "pot", "dues"],
      fr: ["contribution", "caisse"],
    },
    subcategories: [
      {
        id: "group_fund",
        phrases: {
          en: ["group fund", "kitty", "house fund", "common pot"],
          fr: ["caisse commune", "cagnotte", "caisse de la coloc"],
        },
      },
      {
        id: "trip_fund",
        phrases: {
          en: ["trip fund", "travel fund", "holiday fund"],
          fr: ["caisse voyage", "cagnotte voyage", "caisse vacances"],
        },
      },
      {
        id: "membership_dues",
        phrases: {
          en: ["membership dues", "member fee", "club dues"],
          fr: ["cotisation", "cotisation annuelle", "frais de membre"],
        },
      },
      {
        id: "gift_received",
        phrases: {
          en: ["gift received", "birthday money", "wedding gift"],
          fr: ["cadeau recu", "argent cadeau", "cadeau de mariage"],
        },
      },
    ],
  },
  {
    /**
     * Brands earn their keep here, and only here.
     *
     * `vinted` on an outgoing entry is shopping; on an incoming one it can
     * only be a sale. The expense table is never consulted for an income, so
     * these rules never have to defend themselves against the other reading.
     */
    id: "sales",
    strongPhrases: {
      en: ["sold", "proceeds", "ticket sales", "bake sale", "car boot"],
      fr: ["vendu", "recette", "vente de billets", "vide grenier", "brocante"],
    },
    weakKeywords: {
      en: ["sale", "selling"],
      fr: ["vente"],
    },
    merchants: [
      "vinted",
      "ricardo",
      "tutti",
      "anibis",
      "ebay",
      "leboncoin",
      "depop",
      "vestiaire collective",
      "marketplace",
    ],
    subcategories: [
      {
        id: "secondhand",
        merchants: ["vinted", "ricardo", "tutti", "anibis", "depop", "ebay"],
        phrases: {
          en: ["secondhand", "second hand", "used", "preloved"],
          fr: ["occasion", "seconde main", "d occasion"],
        },
      },
      {
        id: "tickets",
        phrases: {
          en: ["ticket sales", "sold tickets", "door takings"],
          fr: ["vente de billets", "billets vendus", "entrees"],
        },
      },
      {
        id: "food_drinks",
        phrases: {
          en: ["bake sale", "bar takings", "food stall", "drinks sold"],
          fr: ["buvette", "vente de gateaux", "recette du bar", "stand"],
        },
      },
      {
        id: "merchandise",
        phrases: {
          en: ["merchandise", "merch", "t shirt sales"],
          fr: ["goodies", "articles vendus", "vente de t shirt"],
        },
      },
    ],
  },
  {
    id: "earnings",
    strongPhrases: {
      en: [
        "salary",
        "wages",
        "payroll",
        "paycheck",
        "pay slip",
        "freelance",
        "invoice paid",
        "client payment",
        "gratuity",
      ],
      fr: [
        "salaire",
        "fiche de paie",
        "honoraire",
        "facture payee",
        "treizieme salaire",
        "13e salaire",
        "pourboire",
      ],
    },
    weakKeywords: {
      en: ["pay", "bonus", "tip"],
      fr: ["paie", "prime"],
    },
    subcategories: [
      {
        id: "salary",
        phrases: {
          en: ["salary", "wages", "payroll", "paycheck", "pay slip"],
          fr: ["salaire", "paie", "fiche de paie"],
        },
      },
      {
        id: "freelance",
        phrases: {
          en: [
            "freelance",
            "invoice paid",
            "client payment",
            "consulting fee",
            "self employed",
          ],
          fr: [
            "honoraire",
            "facture client",
            "facture payee",
            "independant",
            "mission",
          ],
        },
      },
      {
        id: "bonus",
        phrases: {
          en: ["bonus", "13th salary", "thirteenth salary", "profit share"],
          fr: ["prime", "treizieme salaire", "13e salaire", "bonus"],
        },
      },
      {
        id: "tips",
        phrases: {
          en: ["tips", "gratuity", "service charge"],
          fr: ["pourboire", "service"],
        },
      },
    ],
  },
  {
    id: "benefits",
    strongPhrases: {
      en: [
        "housing allowance",
        "family allowance",
        "child benefit",
        "unemployment benefit",
        "scholarship",
        "stipend",
      ],
      fr: [
        "aide au logement",
        "allocation familiale",
        "allocation logement",
        "bourse d etude",
        "subside",
        "chomage",
      ],
    },
    weakKeywords: {
      en: ["allowance", "benefit", "grant", "subsidy"],
      fr: ["allocation", "aide", "subvention"],
    },
    subcategories: [
      {
        id: "housing_allowance",
        phrases: {
          en: ["housing allowance", "housing benefit", "rent subsidy"],
          fr: ["aide au logement", "allocation logement", "subside loyer"],
        },
      },
      {
        id: "family_allowance",
        phrases: {
          en: ["family allowance", "child benefit", "child allowance"],
          fr: ["allocation familiale", "allocation enfant"],
        },
      },
      {
        id: "grant",
        phrases: {
          en: ["grant", "scholarship", "stipend", "bursary"],
          fr: ["bourse", "bourse d etude", "subvention"],
        },
      },
    ],
  },
  {
    id: "financial",
    strongPhrases: {
      en: ["dividend", "cashback", "cash back", "capital gain", "coupon paid"],
      fr: ["dividende", "cashback", "plus value", "interet crediteur"],
    },
    weakKeywords: {
      en: ["interest", "yield"],
      fr: ["interet", "rendement"],
    },
    subcategories: [
      {
        id: "interest",
        phrases: {
          en: ["interest", "savings interest", "interest credited"],
          fr: ["interet", "interet crediteur", "interet epargne"],
        },
      },
      {
        id: "dividends",
        phrases: {
          en: ["dividend", "share dividend"],
          fr: ["dividende"],
        },
      },
      {
        id: "cashback",
        phrases: {
          en: ["cashback", "cash back", "card reward", "loyalty payout"],
          fr: ["cashback", "remise carte", "recompense"],
        },
      },
    ],
  },
];
