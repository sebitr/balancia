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
| `overrides.ts`        | Apple, Amazon, Uber, filling stations, store formats           |
| `confidence.ts`       | Signal groups, score combination, thresholds                   |
| `deterministic.ts`    | Scores every category against the seeds                        |
| `prototypes.ts`       | Short sentences the semantic layer compares against            |
| `semantic.ts`         | The `Embedder` interface and the similarity ranking            |
| `learning.ts`         | What a correction means (pure)                                 |
| `service.ts`          | What a correction is stored as (`server-only`)                 |
| `classifier.ts`       | Puts the passes in order and decides                           |

The browser side of the optional model is `src/lib/semantic/`, and the UI is
`src/components/expenses/category-field.tsx` plus
`use-category-suggestion.ts`. Imports come in through
`src/modules/imports/categories.ts`.

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

## The vocabulary

Fifteen categories and 126 subcategories, in `taxonomy.ts`. That file is the
single source of truth: the types, the validation, the picker's order, the
classifier's constraints and the translation keys are all derived from it.

An expense is a **(category, subcategory) pair**, and the pair is the identity.
A subcategory ID is unique only within its parent — `other` appears fourteen
times, `streaming` and `clothing` twice each, and `activities` is both a
category and one of `kids_family`'s children. `isValidSubcategory(category,
subcategory)` is what every server boundary asks, and `null` is always a valid
answer: an expense filed as `home` with nothing under it is complete, not
half-entered.

Where the lines fall:

| This         | Not that        | The line                                         |
| ------------ | --------------- | ------------------------------------------------ |
| `lodging`    | `transport`     | where the trip slept, not getting there          |
| `activities` | `entertainment` | tickets, tours and entries, not shows and games  |
| `home`       | `shopping`      | the upkeep of a home, not a thing someone bought |

A week's Airbnb is four fifths of a trip's total, so leaving it with the
flights made every holiday chart one bar about the place people slept. A guided
walk and a games console were never the same line.

### What was retired, and what it became

| Old         | New           | Why                                                |
| ----------- | ------------- | -------------------------------------------------- |
| `housing`   | `home`        | Rent, bills and upkeep were one place all along.   |
| `utilities` | `home`        | Which of the three a plumber's invoice belonged to |
| `household` | `home`        | was a coin toss that split a flat-share's largest  |
|             |               | expense across three slices of the spread.         |
| `family`    | `kids_family` | Renamed only. No row changes meaning.              |
| `travel`    | `other`       | It named an occasion, not a kind of spending.      |

The distinction the three `home` codes were really drawing moved down a level,
where it can also be left blank — `home / electricity`, `home / rent`,
`home / repairs`.

`travel` resolves to `other` rather than being guessed apart. Its rows are
flights, hotel nights and museum tickets mixed together, and nothing in a row
says which; picking one would invent a fact and file it under the user's name.
Its _rules_ did move, to the codes that describe the purchase — the airlines
are `transport` now.

Nothing else needs to know about the old codes. `normalizeLegacyCategory()` is
the one place that maps them, and the migration
(`drizzle/0019_fast_nighthawk.sql`) rewrites the stored rows.

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

### Plurals

Words are compared with their plural marker removed, so a rule written once as
`pizza` also answers `Pizzas`. Before this, every plural had to be listed
beside its singular, and the ones nobody remembered were simply invisible:
`Pizza` was recognised and `Pizzas` was not.

`singularize` takes off one trailing `s` or `x` and does nothing else. It is
not a stemmer, and it declines the cases where guessing costs more than
missing:

```
pizzas → pizza      gateaux → gateau
pass   → pass       (an `ss` ending is not a plural: `pas` is half of French)
bus    → bus        (too short; `bus` is not the plural of `bu`)
chevaux → chevaux   (irregular, so it stays its own entry)
```

**Merchants are never folded this way.** `normalizeMerchant` builds the string
that becomes a learned mapping's stored key, so folding there would change the
key of every mapping already written: `migros` would start looking up `migro`
and a household's learned history would silently stop matching.

### Store formats

A few retail groups put one name over several shops. Coop is a supermarket, a
pharmacy, a filling station, a DIY shed and a restaurant; Migros is a
supermarket, a DIY shed and an electronics shop. The format is written on the
receipt, so it decides:

```
COOP BAU+HOBBY LAUSANNE  → home
COOP VITALITY            → health
MIGROS DO IT GARDEN      → home
MIGROS 1234              → groceries
COOP                     → ask (supermarket? pharmacy? petrol?)
```

Format words are matched against the _merchant_, never the description — the
word "coop" in a note about who paid is not a shop. A brand with no format
named stays exactly as ambiguous as it was.

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

## Imported rows

A Splitwise row arrives with the label _its_ app used — `Dining out`,
`Fournitures ménagères`, `Bus/train`. Stored as it stands, that label is not a
category: it gets its own bucket in the spread, no icon, and no rule will ever
match it again. A year of history imports as a legend of one-off strings.

`categorizeImportedExpense()` resolves one, most trustworthy source first:

1. **The source's own leaf.** Splitwise's category list is fixed and public, so
   translating `Dining out` is a lookup, not a guess. English and French
   exports are both covered, and a Balancia code passes through unchanged.
2. **The classifier**, over the description, with the group's learned mappings
   loaded once for the whole run. Only an `auto_assigned` answer is taken — an
   import is unattended, and anything the form would have _asked_ about is not
   something to decide alone.
3. **The source's group**, for exports that write the section rather than the
   leaf. Splitwise files hotels and flights under `Transportation` and a museum
   entry under `Entertainment`, so a group is worth less than a description
   that named one of them — which is why it is consulted here, and not first.
4. **The label, exactly as it came.** Unrecognised is not absent, and the
   source's own word is the only thing the row said about itself.

```
Dining out   + "Chez Léa"        → restaurants   (leaf)
Entertainment + "Museum tickets" → activities    (description beats a group)
Transportation + "Getting around"→ transport     (group, once the text failed)
Food and drink + "Bits"          → "Food and drink"  (kept: the group scatters)
Général      + "Revolu"          → nothing       (the source filed nothing)
```

Some labels are deliberately never translated:

- **`General`, `Other` and their French spellings** mean the source filed
  nothing. They are dropped rather than kept, because a "Général" slice on the
  spread would be a category invented for the rows that have none.
- **Groups whose leaves scatter** — `Food and drink` is half a supermarket and
  half a restaurant, `Life` runs from childcare to taxes.
- **`Insurance`**, because which category it belongs to depends on the policy,
  and the description is what says.

Nothing here writes a learned mapping. An imported label is somebody else's
classification of a merchant this group may never have chosen a category for,
and an import must not teach through the back door.

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

**Installing it.** `./scripts/bootstrap.sh` offers this as one of its setup
questions, and answering yes does both halves: the download, and
`SEMANTIC_CATEGORIZATION=true` in `.env`. To do it by hand instead:

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

1. Add the ID and its subcategories to `EXPENSE_CATEGORIES` in `taxonomy.ts`.
2. Add labels to `expenses.categories` and `expenses.subcategories` in **both**
   `messages/en.json` and `messages/fr.json` —
   `modules/categorization/taxonomy.test.ts` fails on a code with no label or a
   label with no code, and `src/i18n/messages.test.ts` fails on a key that was
   never translated.
3. Add a `CategorySeed` in `seeds.ts`.
4. Add prototypes in `prototypes.ts` if the semantic layer should know it.
5. Draw it: `CATEGORY_GLYPHS` and `SUBCATEGORY_GLYPHS` in
   `components/expenses/category-icon.tsx` are exhaustive over the taxonomy, so
   a code with no glyph is a compile error rather than a blank chip.
6. If an import source names it, add the label to `SOURCE_CATEGORIES` in
   `modules/imports/categories.ts`.

Existing rows keep their old category string; `loadMappings()` translates a
retired code and discards anything else, so a category that was removed
outright cannot come back through an old row.

### Add a subcategory rule

`SUBCATEGORY_SEEDS` at the foot of `seeds.ts`, keyed by the parent category.
Merchants and phrases only — there is deliberately no weak-keyword tier, and
`THRESHOLDS.subcategoryMinScore` is set so that only merchant- or
phrase-strength evidence can fill the field.

The rule to hold to: a subcategory is asserted **only when something named it
outright**. Being confident a purchase is `home` says nothing about which of
its twenty children it is, and a plausible-looking guess filed under the user's
name is worse than the blank it replaced. Partial coverage is the expected
state — most categories name a handful of their children and no more.

### Regrouping a picker pane

`SUBCATEGORY_GROUPS` in `taxonomy.ts`, with labels under
`expenses.categoryGroups`. Only `home` has any: twenty subcategories in one
flat run is a wall, and its four shelves are deliberately the shape of the
three codes that merged into it, so someone who filed rent under Housing for
two years still finds their footing. These are presentation only — never
stored, never part of the pair.

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
