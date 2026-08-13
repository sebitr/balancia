import { containsTokenRun, tokenize } from "./normalize";
import type { PhrasesByLanguage } from "./seeds";
import { allPhrases } from "./seeds";
import type { TransactionType } from "./types";

/**
 * Transaction-type detection.
 *
 * Runs before categorization, because a refund or a salary is not a small
 * purchase of something — it is not spending at all, and asking "which
 * category?" about it is the wrong question.
 *
 * Every rule comes in two strengths:
 *
 *  - `phrases` decide on their own. They say what happened: `travel
 *    reimbursement`, `remboursement carte`, `fiche de paie`.
 *  - `generics` are words that *often* mean the type and often do not —
 *    `transfer`, `virement`, `prime`, `commission`. On their own they decide
 *    nothing; they need a corroborator from the same rule. This is what keeps
 *    `AMAZON PRIME` an expense and `frais de traitement` a fee.
 *
 * When several rules match, the longest match wins, then `RULE_PRIORITY`.
 */

interface TransactionTypeRule {
  readonly type: TransactionType;
  readonly phrases: PhrasesByLanguage;
  readonly generics?: PhrasesByLanguage;
  readonly corroborators?: PhrasesByLanguage;
}

const RULES: readonly TransactionTypeRule[] = [
  {
    type: "reimbursement",
    phrases: {
      en: [
        "expense reimbursement",
        "expenses reimbursement",
        "reimbursed expenses",
        "travel reimbursement",
        "work reimbursement",
      ],
      fr: [
        "remboursement de frais",
        "remboursement frais",
        "frais remboursés",
        "remboursement professionnel",
        "remboursement déplacement",
      ],
    },
  },
  {
    type: "refund",
    phrases: {
      en: [
        "refund",
        "refunded",
        "card refund",
        "merchant refund",
        "purchase refund",
        "returned payment",
        "reversal",
        "reversed payment",
        "charge reversal",
        "credit note",
      ],
      fr: [
        "remboursement",
        "remboursé",
        "remboursement carte",
        "remboursement achat",
        "retour marchand",
        "opération annulée",
        "paiement annulé",
        "contre-passation",
      ],
    },
    // "avoir" is the commonest verb in French before it is a credit note.
    generics: { fr: ["avoir"] },
    corroborators: {
      en: ["store", "purchase", "card", "return"],
      fr: ["magasin", "boutique", "achat", "carte", "retour", "commercial"],
    },
  },
  {
    type: "salary",
    phrases: {
      en: [
        "salary",
        "payroll",
        "wages",
        "wage payment",
        "monthly salary",
        "employer payment",
        "paycheque",
        "paycheck",
      ],
      fr: [
        "salaire",
        "paie",
        "rémunération",
        "versement salaire",
        "salaire mensuel",
        "fiche de paie",
      ],
    },
    // "traitement" is a salary, a medical treatment and a processing fee.
    generics: { fr: ["traitement"] },
    corroborators: {
      fr: ["salaire", "mensuel", "employeur", "brut", "net", "paie"],
    },
  },
  {
    type: "transfer",
    phrases: {
      en: [
        "internal transfer",
        "account transfer",
        "transfer between accounts",
        "balance transfer",
        "bank transfer to savings",
        "bank transfer from savings",
        "move money",
        "settlement",
        "split settlement",
      ],
      fr: [
        "virement interne",
        "virement entre comptes",
        "transfert entre comptes",
        "transfert interne",
        "versement sur épargne",
        "retrait de l'épargne",
        "règlement de solde",
      ],
    },
    generics: {
      en: ["transfer"],
      fr: ["virement", "transfert"],
    },
    corroborators: {
      en: ["savings", "account", "accounts", "internal", "own", "iban"],
      fr: [
        "épargne",
        "compte",
        "comptes",
        "interne",
        "propre",
        "iban",
        "solde",
      ],
    },
  },
  {
    type: "gift_income",
    /**
     * Only money *received*. `birthday gift` and `cadeau anniversaire` are
     * deliberately absent: in a shared-expense app those overwhelmingly mean
     * buying someone a present, which is the `gifts` category.
     */
    phrases: {
      en: ["gift received", "cash gift", "money gift"],
      fr: ["cadeau reçu", "argent cadeau", "don reçu"],
    },
  },
  {
    type: "other_income",
    phrases: {
      en: [
        "interest payment",
        "bank interest",
        "dividend",
        "dividends",
        "bonus payment",
        "commission payment",
        "prize money",
      ],
      fr: [
        "intérêts bancaires",
        "versement intérêts",
        "dividende",
        "dividendes",
      ],
    },
    // `prime` is Amazon's, and `commission` is usually a bank fee.
    generics: { fr: ["prime", "commission", "gain"] },
    corroborators: {
      en: ["received", "payment", "employer", "annual"],
      fr: ["versement", "reçu", "employeur", "annuelle", "salaire"],
    },
  },
];

/** Tie-break when two rules match equally long. */
const RULE_PRIORITY: readonly TransactionType[] = [
  "reimbursement",
  "refund",
  "salary",
  "transfer",
  "gift_income",
  "other_income",
];

interface CompiledRule {
  readonly type: TransactionType;
  readonly phrases: readonly string[][];
  readonly generics: readonly string[][];
  readonly corroborators: readonly string[][];
}

const COMPILED: readonly CompiledRule[] = RULES.map((rule) => ({
  type: rule.type,
  phrases: allPhrases(rule.phrases).map(tokenize),
  generics: allPhrases(rule.generics).map(tokenize),
  corroborators: allPhrases(rule.corroborators).map(tokenize),
}));

export interface TransactionTypeDetection {
  readonly type: TransactionType;
  /** The phrases that decided it, for the result's explanation. */
  readonly signals: readonly string[];
}

/**
 * Classifies the transaction itself. Defaults to `expense`, which is what an
 * expense-sharing app is nearly always looking at.
 */
export function detectTransactionType(text: string): TransactionTypeDetection {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { type: "expense", signals: [] };

  let best: { rule: CompiledRule; match: string[] } | null = null;

  for (const rule of COMPILED) {
    const matches = rule.phrases.filter((phrase) =>
      containsTokenRun(tokens, phrase),
    );

    // A generic word only counts when something else in the text agrees.
    const corroborated = rule.corroborators.some((phrase) =>
      containsTokenRun(tokens, phrase),
    );
    if (corroborated) {
      matches.push(
        ...rule.generics.filter((phrase) => containsTokenRun(tokens, phrase)),
      );
    }

    for (const match of matches) {
      if (best === null || isBetter(match, rule, best)) {
        best = { rule, match };
      }
    }
  }

  if (best === null) return { type: "expense", signals: [] };
  return {
    type: best.rule.type,
    signals: [`type:${best.match.join(" ")}`],
  };
}

function isBetter(
  match: readonly string[],
  rule: CompiledRule,
  current: { rule: CompiledRule; match: string[] },
): boolean {
  if (match.length !== current.match.length) {
    return match.length > current.match.length;
  }
  return (
    RULE_PRIORITY.indexOf(rule.type) < RULE_PRIORITY.indexOf(current.rule.type)
  );
}

/** True for the types that are not money going out. */
export function isIncomeLike(type: TransactionType): boolean {
  return (
    type === "income" ||
    type === "salary" ||
    type === "gift_income" ||
    type === "other_income" ||
    type === "refund" ||
    type === "reimbursement"
  );
}
