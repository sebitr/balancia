"use client";

import { createElement, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SheetTitle } from "@/components/ui/sheet";
import type { EntryDirection } from "@/modules/expenses/direction";
import { categoryShortlist } from "./entry-logic";
import type { CategorySuggestion } from "@/components/expenses/use-category-suggestion";
import { ChoicePill } from "./pills";
import { useVocabulary, type Vocabulary } from "./vocabulary";

/**
 * Picking a category, and optionally what kind of one.
 *
 * Two levels in one sheet, and a tap always commits. The root is the whole
 * vocabulary; tapping a category writes it immediately and slides its
 * subcategories in behind. Dismissing from there is not an abandoned journey —
 * the entry keeps the category with `subcategory: null`, which is a complete
 * answer. That is the whole reason the second level can be optional rather
 * than a step to escape from: there is nothing to escape, because the work is
 * already saved by the time the second question is asked.
 *
 * *Which* vocabulary is the direction's business, not this file's — see
 * `useVocabulary`. Expense and income keep separate lists, and everything
 * below takes plain strings: a code is data, and which list it came from is
 * settled before a chip is drawn.
 *
 * The root still leads with a few chips rather than the whole list. Eighteen
 * categories in the reader's alphabet is a wall, and the one they want is
 * rarely near the top of it: it is either what the description already says or
 * what this group files most things under. The heading over those chips says
 * which of the two it is, and it has to stay honest — "Because it says…" over
 * a list the description had no part in would be the interface claiming to
 * have read something it did not.
 *
 * Search is what keeps two hundred and seventeen subcategories usable, and it
 * is why two levels are not slower than one: typing `carburant` reaches the
 * leaf directly and one tap sets both halves, without ever opening a pane.
 */

export function CategorySheet({
  value,
  subcategory,
  detectedValue,
  description,
  suggestion,
  frequent,
  direction = "out",
  onSelect,
  onDone,
  onRevert,
}: {
  value: string;
  /** The stored subcategory, or "" — only meaningful against `value`. */
  subcategory: string;
  /** What the classifier would say, so an override can be handed back. */
  detectedValue: string;
  /** Quoted in the shortlist heading, so the guess shows its evidence. */
  description: string;
  /** The live classification, or null while there is nothing to classify. */
  suggestion: CategorySuggestion | null;
  /** What this group files things under, most used first. */
  frequent: readonly string[];
  /** Which vocabulary to offer. Absent means spending. */
  direction?: EntryDirection;
  /** Always both halves: picking a category alone clears the old child. */
  onSelect: (category: string, subcategory: string | null) => void;
  /**
   * The journey is over — close.
   *
   * Separate from `onSelect` because the sheet is the only thing that knows:
   * tapping `Transport` at the root and tapping `Just Transport` in its pane
   * both write `transport` with no child, and only the second one is finished.
   * Asking the caller to tell them apart from the arguments would make it
   * re-derive the pane it cannot see.
   */
  onDone: () => void;
  /** Drops the manual override and lets detection have the field back. */
  onRevert: () => void;
}) {
  const t = useTranslations("addEntry.category");
  const vocabulary = useVocabulary(direction);
  const locale = useLocale();
  const [query, setQuery] = useState("");
  /** Which pane is open, or null for the root. Not a route, not a sheet. */
  const [pane, setPane] = useState<string | null>(null);

  const collator = useMemo(() => new Intl.Collator(locale), [locale]);

  /** The reader's own alphabetical order, with `other` pinned last. */
  const ordered = useMemo(() => {
    const named = vocabulary.ids
      .filter((category) => category !== "other")
      .map((category) => ({ category, label: vocabulary.label(category) }));
    named.sort((a, b) => collator.compare(a.label, b.label));
    return [...named, { category: "other", label: vocabulary.label("other") }];
  }, [collator, vocabulary]);

  /*
   * The shortlist, filtered to codes this vocabulary actually has.
   *
   * "Most used in this group" is counted over the group's expenses, and on an
   * income those codes name nothing: the sheet rendered
   * `expenses.incomeCategories.restaurants` as a chip, because a missing
   * translation falls back to its own key. A code from the other vocabulary
   * is not a chip with a bad label, it is not a chip.
   */
  const shortlist = useMemo(() => {
    const all = categoryShortlist({ suggestion, frequent });
    const categories = all.categories.filter(vocabulary.owns);
    return { ...all, categories };
  }, [suggestion, frequent, vocabulary]);

  const needle = fold(query.trim(), locale);
  const searching = needle !== "";

  /**
   * Searching drops the grouping and filters everything.
   *
   * A shortlist is an answer to "what do you probably want", and typing is
   * someone saying they want something else. Keeping the suggestions above the
   * results would put three categories they did not ask for over the one they
   * are spelling out.
   *
   * Matching is done on the label rather than the code, because the code is
   * not what is on screen — and it is accent- and case-insensitive, so `sante`
   * finds Santé, which is the whole point on a keyboard that makes accents
   * expensive.
   */
  const results = useMemo(() => {
    if (!searching) return [];
    return ordered.filter(({ label }) => fold(label, locale).includes(needle));
  }, [ordered, needle, searching, locale]);

  /**
   * Leaf matches, above the category ones.
   *
   * Somebody typing a specific word wants the specific thing: `ren` should
   * reach Rent and Renovation before it reaches the categories they live in.
   * Capped, because 176 leaves can match loosely and a list nobody can see the
   * end of is not a result.
   */
  const leafResults = useMemo(() => {
    if (!searching) return [];
    const hits: {
      category: string;
      subcategory: string;
      label: string;
    }[] = [];
    for (const category of vocabulary.ids) {
      for (const leaf of vocabulary.leaves(category)) {
        const label = vocabulary.leafLabel(category, leaf);
        if (fold(label, locale).includes(needle)) {
          hits.push({ category, subcategory: leaf, label });
        }
      }
    }
    hits.sort(
      (a, b) =>
        collator.compare(a.label, b.label) ||
        collator.compare(
          vocabulary.label(a.category),
          vocabulary.label(b.category),
        ),
    );
    return hits.slice(0, MAX_LEAF_RESULTS);
  }, [searching, needle, locale, collator, vocabulary]);

  /** The alphabet minus whatever is already offered above it. */
  const rest = useMemo(
    () =>
      ordered.filter(
        ({ category }) => !shortlist.categories.includes(category),
      ),
    [ordered, shortlist],
  );

  const overridden = detectedValue !== "" && value !== detectedValue;

  /**
   * A category chip.
   *
   * Tapping it commits the category and clears whatever child was under the
   * old one, then opens the pane when there is one to open. `other` has none,
   * so its chip carries no chevron and its tap ends the journey — the shape of
   * the control says where it goes.
   */
  const chip = ({ category, label }: { category: string; label: string }) => {
    const branches = vocabulary.leaves(category).length > 0;
    return (
      <ChoicePill
        key={category}
        selected={category === value}
        icon={vocabulary.glyph(category)}
        trailing={
          branches ? (
            <ChevronRight aria-hidden="true" className="size-3 shrink-0" />
          ) : null
        }
        onClick={() => {
          onSelect(category, null);
          if (!branches) {
            onDone();
            return;
          }
          setQuery("");
          setPane(category);
        }}
      >
        {label}
      </ChoicePill>
    );
  };

  if (pane) {
    return (
      <SubcategoryPane
        category={pane}
        selected={value === pane ? subcategory : ""}
        collator={collator}
        vocabulary={vocabulary}
        onBack={() => setPane(null)}
        // Everything in the pane ends the journey, the skip row included.
        onSelect={(leaf) => {
          onSelect(pane, leaf);
          onDone();
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <SheetTitle className="text-lg font-semibold tracking-[-0.02em]">
          {t("title")}
        </SheetTitle>
        {overridden && (
          <button
            type="button"
            onClick={onRevert}
            className="shrink-0 text-xs text-primary-ink underline underline-offset-2"
          >
            {t("backToDetected")}
          </button>
        )}
      </div>

      <div className="relative shrink-0">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          className="h-12 pl-9"
        />
      </div>

      <div className="-mx-1 min-h-0 flex-auto space-y-4 overflow-y-auto px-1 pb-1">
        {searching ? (
          <>
            {leafResults.length > 0 && (
              <Group heading={t("subcategories")}>
                {leafResults.map((hit) => (
                  <LeafPill
                    key={`${hit.category}.${hit.subcategory}`}
                    category={hit.category}
                    subcategory={hit.subcategory}
                    parentLabel={vocabulary.label(hit.category)}
                    label={hit.label}
                    selected={
                      value === hit.category && subcategory === hit.subcategory
                    }
                    vocabulary={vocabulary}
                    onClick={() => {
                      onSelect(hit.category, hit.subcategory);
                      onDone();
                    }}
                  />
                ))}
              </Group>
            )}
            <Group heading={t("results")}>
              {results.map(chip)}
              {results.length === 0 && leafResults.length === 0 && (
                <p className="py-4 text-sm text-muted-foreground">
                  {t("noMatch")}
                </p>
              )}
            </Group>
          </>
        ) : (
          <>
            {shortlist.categories.length > 0 && (
              <Group
                heading={
                  shortlist.fromDescription
                    ? t("because", { description: description.trim() })
                    : t("mostUsed")
                }
              >
                {shortlist.categories.map((category) =>
                  chip({ category, label: vocabulary.label(category) }),
                )}
              </Group>
            )}
            <Group heading={t("all")}>{rest.map(chip)}</Group>
          </>
        )}
      </div>
    </div>
  );
}

/** How many leaf hits are worth showing before the list stops being a result. */
const MAX_LEAF_RESULTS = 12;

/**
 * One category's subcategories, in place of the root.
 *
 * The skip row comes first, before any subcategory, because it is the fast way
 * out and its position is what proves the second level is optional. The
 * helper line under the chips says the same thing in words, for anyone who
 * read the pane as a question they have to answer.
 */
/**
 * A category's glyph, looked up through its vocabulary.
 *
 * A component rather than `const Glyph = vocabulary.glyph(category)` inside
 * the render: the lookup is a *call*, and a component value produced by one
 * during render is a new component identity every pass — React would remount
 * it, and the lint rule that says so is right even though an icon has no state
 * to lose.
 */
function VocabularyGlyph({
  vocabulary,
  category,
  className,
}: {
  vocabulary: Vocabulary;
  category: string;
  className?: string;
}) {
  /*
   * `createElement` rather than JSX, because the identity is stable and the
   * lint rule cannot see that: every glyph comes out of a module-level map,
   * so the same category yields the same component on every render. What the
   * rule guards against — a component *defined* during render, remounted each
   * pass — is not what a table lookup does. Calling it through a function is
   * the only thing that hides it.
   */
  return createElement(vocabulary.glyph(category), {
    "aria-hidden": true,
    className,
  });
}

function SubcategoryPane({
  category,
  selected,
  collator,
  vocabulary,
  onBack,
  onSelect,
}: {
  category: string;
  selected: string;
  collator: Intl.Collator;
  vocabulary: Vocabulary;
  onBack: () => void;
  onSelect: (subcategory: string | null) => void;
}) {
  const t = useTranslations("addEntry.category");
  const tGroups = useTranslations("expenses.categoryGroups");
  const groups = vocabulary.groups(category);

  const label = (leaf: string) => vocabulary.leafLabel(category, leaf);

  /** Alphabetical, `other` last — the same rule the root uses. */
  const sorted = (leaves: readonly string[]) =>
    [...leaves]
      .filter((leaf) => leaf !== "other")
      .sort((a, b) => collator.compare(label(a), label(b)));

  const leaves = vocabulary.leaves(category);
  const ungrouped = groups
    ? []
    : sorted(leaves).concat(leaves.includes("other") ? ["other"] : []);

  const pill = (leaf: string) => (
    <ChoicePill
      key={leaf}
      selected={leaf === selected}
      icon={vocabulary.leafGlyph(category, leaf)}
      onClick={() => onSelect(leaf)}
    >
      {label(leaf)}
    </ChoicePill>
  );

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("backToCategories")}
          className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-white/4 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <VocabularyGlyph
          vocabulary={vocabulary}
          category={category}
          className="size-[18px] shrink-0 text-primary-ink"
        />
        <SheetTitle className="truncate text-lg font-semibold tracking-[-0.02em]">
          {vocabulary.label(category)}
        </SheetTitle>
      </div>

      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selected === ""}
        className="flex h-12 shrink-0 items-center justify-between gap-3 rounded-xl border border-border bg-white/4 px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
      >
        <span className="truncate">
          {t("just", { category: vocabulary.label(category) })}
        </span>
        {selected === "" && (
          <Check
            aria-hidden="true"
            className="size-4 shrink-0 text-primary-ink"
          />
        )}
      </button>

      <div className="-mx-1 min-h-0 flex-auto space-y-4 overflow-y-auto px-1 pb-1">
        {groups ? (
          <>
            {groups.map(({ group, subcategories }) => (
              <Group
                key={group}
                heading={tGroups(
                  `${category}.${group}` as Parameters<typeof tGroups>[0],
                )}
              >
                {sorted(subcategories).map(pill)}
              </Group>
            ))}
            {leaves.includes("other") && (
              <div className="flex flex-wrap gap-2">{pill("other")}</div>
            )}
          </>
        ) : (
          <div className="flex flex-wrap gap-2">{ungrouped.map(pill)}</div>
        )}

        <p className="text-xs text-muted-foreground">{t("optionalHint")}</p>
      </div>
    </div>
  );
}

/**
 * A leaf hit from search, drawn as the breadcrumb it is.
 *
 * The parent is muted and the leaf is not, because the leaf is what matched
 * and what the tap will set — and a bare "Other" in a results list would name
 * seventeen different things.
 */
function LeafPill({
  category,
  subcategory,
  parentLabel,
  label,
  selected,
  vocabulary,
  onClick,
}: {
  category: string;
  subcategory: string;
  parentLabel: string;
  label: string;
  selected: boolean;
  vocabulary: Vocabulary;
  onClick: () => void;
}) {
  return (
    <ChoicePill
      selected={selected}
      icon={vocabulary.leafGlyph(category, subcategory)}
      onClick={onClick}
    >
      <span className="font-normal text-muted-foreground">{parentLabel}</span>
      <ChevronRight
        aria-hidden="true"
        className="mx-1 inline size-3 align-[-0.1em] text-muted-foreground"
      />
      <span className="font-semibold text-foreground">{label}</span>
    </ChoicePill>
  );
}

/**
 * A heading and the chips under it.
 *
 * The heading is a real one rather than styled text: it is how somebody
 * arrowing through the sheet finds out that these three chips are a shortlist
 * and the twelve below are the rest.
 */
function Group({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="line-clamp-1 text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {heading}
      </h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

/** Folds case and accents, so `sante` finds Santé and `hopital` finds Hôpital. */
function fold(value: string, locale: string): string {
  return value
    .toLocaleLowerCase(locale)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * The reader's label for a (category, subcategory) pair.
 *
 * The cast is the one place the nesting costs something: `t()` is typed over
 * the literal key paths in `en.json`, and `${category}.${subcategory}` is a
 * cross product of eighteen parents and a hundred and seventy-six leaves, most
 * of which are not real paths. The pairs this is called with always are —
 * every caller iterates `getSubcategories(category)` — so the check is done by
 * the taxonomy rather than by the key type.
 */
export function useSubcategoryLabel(): (
  category: string,
  subcategory: string,
) => string {
  const tSub = useTranslations("expenses.subcategories");
  return (category, subcategory) =>
    tSub(`${category}.${subcategory}` as Parameters<typeof tSub>[0]);
}
