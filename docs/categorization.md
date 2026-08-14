# Automatic expense categorization

Balancia suggests a category for an expense as it is typed. The whole thing
runs on the instance: rules in `src/modules/categorization`, an optional
sentence model in the browser, and nothing sent anywhere. There is no AI API
key to configure, because there is no AI API.

English and French are supported out of the box, and adding a language is
adding entries to a data file.

## Where the code lives

| File                  | What it does                                                   |
| --------------------- | -------------------------------------------------------------- |
| `types.ts`            | Category and transaction-type IDs, the input and result shapes |
| `normalize.ts`        | Turns a bank descriptor into a comparable merchant             |
| `transaction-type.ts` | Refund, salary, transfer… before any category is considered    |
| `seeds.ts`            | The rule data: merchants, phrases, keywords, exclusions        |
| `overrides.ts`        | Apple, Amazon, Uber, filling stations                          |
| `confidence.ts`       | Signal groups, score combination, thresholds                   |
| `deterministic.ts`    | Scores every category against the seeds                        |
| `prototypes.ts`       | Short sentences the semantic layer compares against            |
| `semantic.ts`         | The `Embedder` interface and the similarity ranking            |
| `learning.ts`         | What a correction means (pure)                                 |
| `service.ts`          | What a correction is stored as (`server-only`)                 |
| `classifier.ts`       | Puts the passes in order and decides                           |

The browser side of the optional model is `src/lib/semantic/`, and the UI is
`src/components/expenses/category-field.tsx` plus
`use-category-suggestion.ts`.

Everything except `service.ts` is pure and framework-free, so the same code
runs in a Server Action, in the recurring-expense worker, and in the browser
as someone types.

## The flow

```
description / notes
        │
        ▼
  transaction type ──── not an expense? ──► never auto-assign
        │
        ▼
  learned mapping? ──── yes ──► decided, stop  (no model, no ranking)
        │ no
        ▼
  contextual overrides ─┐
  merchant match       ─┤
  strong phrases       ─┼──► signals ──► ranked categories
  weak keywords        ─┤
  recurring bonus      ─┘
        │
        ├── score ≥ 0.82 and 0.12 clear of second ──► filled in
        ├── score ≥ 0.55                          ──► up to 3 suggestions
        └── otherwise ──► semantic pass, if installed ──► else ask
```

The deterministic pass is synchronous string matching over pre-compiled token
arrays. It runs on every (debounced) keystroke and the form never waits for
anything.

## Matching priority

1. explicit transaction type
2. group learned mapping
3. user learned mapping
4. contextual override
5. exact normalized merchant
6. merchant family
7. strong phrase
8. multiple keywords
9. semantic similarity
10. nothing — ask

Steps 1 and 2–3 are _decisions_ and stop the pipeline. Steps 4–9 are
_evidence_: they are scored, combined and ranked against each other.

## Confidence

Weights (`SIGNAL_WEIGHTS`):

| Signal                               | Score |
| ------------------------------------ | ----- |
| learned mapping (group or user)      | 1.00  |
| learned mapping recently overwritten | 0.90  |
| contextual override                  | 0.95  |
| exact merchant                       | 0.95  |
| strong phrase                        | 0.90  |
| merchant family                      | 0.85  |
| several distinct keywords            | 0.75  |
| ambiguous merchant                   | 0.55  |
| single keyword                       | 0.45  |
| recurring, towards subscriptions     | 0.15  |

Thresholds (`THRESHOLDS`):

- **0.82** — the score needed to fill the field in
- **0.12** — how far ahead of the runner-up it must also be
- **0.55** — the score below which nothing is offered at all

Two rules keep those numbers meaningful.

**Signals are grouped, and a group counts once.** `restaurant restaurant
restaurant` is one piece of evidence, and `uber eats` does not also collect
credit for `uber` and for `eats` — within a group, the longest match wins and
only the strongest score survives. The one exception is keywords, where
several _different_ weak words are worth more together (0.75) than the best of
them alone (0.45).

**Groups combine with noisy-OR, never by addition:**

```
combined = 1 − Π (1 − score)
```

Two 0.9 signals give 0.99, not 1.8. Confidence stays inside `[0, 1)` whatever
is thrown at it, so a threshold means the same thing forever.

The margin rule is what stops confident nonsense. `Dinner at Migros` scores
0.90 for restaurants and 0.85 for groceries: high, and 0.05 apart. It is
offered, not applied.

`other` is a fallback only. It has no rules, it never appears among the
suggestions, and it can only be chosen deliberately.

## Merchant normalization

`CB CARREFOUR MARKET PARIS 12/05 CARTE 1234` is not something to match against
directly. `normalizeMerchant()` folds case and accents, strips card and payment
prefixes, removes _structured_ noise (dates, card masks, authorization codes,
long identifiers), and drops a trailing city.

The original text is never modified — `rawMerchant` is what people see,
`normalizedMerchant` is only ever used for matching. Rule data goes through the
same function, so both sides of every comparison are normalized identically.

Digit groups are deliberately **kept**: `MICROSOFT 365` and `INIT7` mean their
digits, `MIGROS 1234` does not. The matcher decides which is which, using
`isIdentifyingPrefix` — a single-word rule matches only when it _opens_ the
descriptor and everything after it is noise. That is why `MIGROS 1234` is
Migros and `Max's birthday dinner` is not the streaming service.

Payment processors are unwrapped, never classified:

```
PAYPAL *SPOTIFY            → spotify
SQ *CAFE CENTRAL           → cafe central
SUMUP *BOULANGERIE DUPONT  → boulangerie dupont
PAYPAL *ABCDEF123          → nothing identifiable → ask
```

## Learned mappings

A category someone picks is stored as a rule for that merchant, in two scopes:
the **group** learns the household's habit, the **user** learns their own. On
the next expense, a matching mapping wins outright — it is not evidence to be
weighed against a keyword.

Mappings are keyed on `merchantKey()`, the merchant with store numbers removed,
so `MIGROS 1234` and `MIGROS 5678` share one rule.

- the first choice creates the mapping
- confirming it again raises `correction_count`
- choosing differently replaces it, resets the count and raises
  `conflict_count` — which lowers confidence until the new answer is confirmed
- a group mapping outranks a user mapping, and when one exists the user's is
  not consulted at all (otherwise a disagreement is two categories at 1.0 with
  no margin between them)
- a learned mapping never becomes a global rule

Nothing is learned from an imported free-text label, from `other`, or from a
merchant that normalizes to nothing.

Storage is `expense_category_mappings` (migration `0004`), written in the same
transaction as the expense that taught it. Guests have no user account, so
their corrections teach the group scope only.

## The semantic layer (optional)

Rules cannot cover `Souper chez Léa`. A multilingual sentence model can,
because it puts that near `dîner au restaurant` without anyone writing the
rule.

It is off by default and Balancia is fully functional without it — the
deterministic rules are the classifier, and this only adds a fallback for text
they do not cover.

**How it works.** `semantic.ts` defines an `Embedder` interface. The shipped
implementation runs
[`Xenova/paraphrase-multilingual-MiniLM-L12-v2`](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2)
in a Web Worker via Transformers.js, against files served by this instance.
Category prototypes are embedded once per tab and reused; transaction text is
embedded per classification and compared by cosine similarity.

Similarity is _not_ used as a probability. It is mapped through a linear ramp
(`SEMANTIC_TUNING`: floor 0.35, ceiling 0.75) and capped at **0.80** — below
the 0.82 auto-assign threshold, on purpose. A model that has never seen this
household's habits can suggest on its own, but can only help _decide_
alongside other evidence.

The model is never asked about a transaction the rules already settled, or one
a learned mapping already answered.

**Installing it.**

```bash
pnpm semantic:install --yes
```

That downloads ~150 MB into `public/models` (git-ignored): the Transformers.js
bundle, the onnxruntime-web WebAssembly binaries, and the quantized model. It
is the only moment Balancia talks to a model host, and it is an operator
running a command, not the application.

Then set:

```bash
SEMANTIC_CATEGORIZATION=true
```

That switch also adds `'wasm-unsafe-eval'` to the Content-Security-Policy,
which WebAssembly compilation needs and which is otherwise deliberately
absent. It permits WASM compilation and nothing else — it is not
`unsafe-eval`.

In Docker, `public/models` lives inside the image, so mount it to survive a
rebuild:

```yaml
services:
  app:
    volumes:
      - ./models:/app/public/models:ro
```

If the files are missing the browser's one `HEAD` request fails, no worker is
ever created, and classification stays deterministic. Nothing to switch off.

**Implementation note.** The worker is built from a `Blob` rather than
bundled. It has to be a _module_ worker — its whole job is a dynamic
`import()` of the runtime — and Turbopack's `new Worker(new URL(...))`
handling strips the `type` option, producing a classic worker. Building it
from source text makes the type ours to choose, and keeps Transformers.js out
of the module graph entirely, which is why an instance that never installs the
model carries none of it. `worker-src 'self' blob:` was already in the policy.
`src/lib/semantic/worker-source.test.ts` is what stands in for the compiler on
that file.

**What to check the first time you enable it.** Open an expense form and watch
the browser console. The failure modes are all silent by design, so a working
setup looks like a request for `/models/runtime/transformers.min.js` followed
by the model files; a CSP violation or a 404 there means the layer is off and
the rules are answering alone.

## Extending it

### Add a merchant

`seeds.ts`, in the category's `merchants` list, lower-case and as it appears on
a statement. Nothing else to touch — rules are compiled through
`normalizeMerchant()` at load.

Choose the right list:

- `merchants` — this brand means this category (`zooplus`, `swisscom`)
- `merchantFragments` — this _word_ names the trade (`pharmacie`, `vet`)
- `ambiguousMerchants` — this brand really does sell across categories
  (`amazon`, `coop pronto`). Worth a suggestion, never a decision.

A brand that spans categories in a way the text can settle belongs in
`overrides.ts` instead.

### Add a category

1. Add the ID to `EXPENSE_CATEGORIES` in `types.ts`.
2. Add labels to `expenses.categories` in **both** `messages/en.json` and
   `messages/fr.json` — `src/i18n/messages.test.ts` fails on a missing
   translation.
3. Add a `CategorySeed` in `seeds.ts`.
4. Add prototypes in `prototypes.ts` if the semantic layer should know it.

Existing rows keep their old category string; `loadMappings()` discards
mappings whose category is no longer in the vocabulary, so a removed category
cannot come back through an old row.

### Add a language

Phrase buckets are keyed by language subtag purely for maintenance —
matching is language-agnostic, because a transaction does not say what
language it is in.

1. In `seeds.ts`, add the key to `strongPhrases` and `weakKeywords` for each
   category.
2. In `transaction-type.ts`, add it to `phrases`, `generics` and
   `corroborators`.
3. In `prototypes.ts`, append the language's phrasings.
4. Add accented forms as written — accents are folded before matching.

Nothing in the classifier needs to change, and the new language works
immediately for every existing rule.

## Privacy

- No external AI API, and no key for one.
- Transaction text is never sent to a third-party inference service. The
  deterministic pass is local by construction; the optional model runs in the
  browser against files this instance serves, with `allowRemoteModels = false`
  so it cannot fall back to a CDN.
- Learned mappings stay in this instance's database and are never shared
  between groups.
- Descriptions and receipt text are not logged. Classification produces a
  `signals` array naming the _rules_ that matched, not the text they matched
  in.
- The classifier only ever reads fields that describe the purchase. Participant
  names, IDs and card numbers are not part of its input.

## Testing

```bash
pnpm test:unit                  # rules, scoring, normalization, learning
pnpm test:integration           # mappings against real PostgreSQL
```

`classifier.test.ts` is the readable specification: representative English and
French descriptors, the ambiguity and margin behaviour, and the guarantees
about `other`.
