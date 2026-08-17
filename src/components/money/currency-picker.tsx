"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Check, Search, Star, X } from "lucide-react";
import { SheetTitle } from "@/components/ui/sheet";
import {
  currencyCatalogue,
  searchCurrencies,
  type CurrencyEntry,
} from "@/modules/currencies/catalog";
import { useCurrencyFavorites } from "@/components/money/currency-favorites";
import { cn } from "@/lib/utils";

/**
 * Choosing a currency, out of all hundred and fifty-six.
 *
 * A full-height list rather than the native `<select>` this replaced. The
 * platform picker was one tap away from the right answer only if the right
 * answer was in the ten currencies pinned at the top of it; for the eleventh
 * it was a scroll through an alphabet nobody has memorised. Search that also
 * matches the country closes that — `bali` finds the rupiah, `etats` finds the
 * dollar — and the star turns the second trip into the same one tap the first
 * one wanted.
 *
 * The view fills its container and does not open one of its own: it is the
 * second screen of whatever sheet asked for it, the way the icon picker is the
 * second screen of the group form. Nothing is confirmed — tapping a row is the
 * choice, and the back arrow leaves without making one.
 */

export function CurrencyPicker({
  value,
  title,
  onSelect,
  onBack,
}: {
  /** The currently chosen code. Marked in the list, never moved to the top. */
  value: string;
  /** Mirrors the row that opened it: "Devise de référence", "Devise". */
  title: string;
  onSelect: (code: string) => void;
  onBack: () => void;
}) {
  const t = useTranslations("currencyPicker");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const { favorites, toggle } = useCurrencyFavorites();

  const catalogue = currencyCatalogue(locale);

  /**
   * Read once, when the view opens.
   *
   * Starring a currency must not make its row jump out from under the finger
   * that starred it, so the sections are built from the favourites as they
   * were on the way in — state with an initial value rather than a ref,
   * because this is read while rendering. The next open sees the new order.
   */
  const [pinned] = useState(favorites);

  const sections = useMemo(
    () => buildSections(catalogue, pinned, query, t),
    [catalogue, pinned, query, t],
  );

  const empty = sections.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-right-3">
      <header className="flex shrink-0 items-center gap-2 px-5 pt-2.5 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-full text-foreground/85 transition-colors duration-150 hover:bg-foreground/8 hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-[18px]" />
          <span className="sr-only">{t("back")}</span>
        </button>
        {/* A Radix dialog needs a title, and this view is always the content
            of one — either its own sheet or the second screen of somebody
            else's. Styled here rather than in `SheetTitle`, which the rest of
            the app uses at a smaller size. */}
        <SheetTitle className="min-w-0 flex-1 text-lg font-semibold tracking-[-0.02em]">
          {title}
        </SheetTitle>
      </header>

      <div className="shrink-0 px-5 pb-3">
        <SearchField value={query} onChange={setQuery} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
        {sections.map((section) => (
          <section key={section.title} className="flex flex-col gap-1.5">
            <h3 className="px-0.5 py-0.5 text-xs font-semibold tracking-[0.07em] text-muted-foreground uppercase">
              {section.title}
            </h3>
            {section.items.map((entry) => (
              <CurrencyRow
                key={entry.code}
                entry={entry}
                selected={entry.code === value}
                favorite={favorites.includes(entry.code)}
                onSelect={() => {
                  setQuery("");
                  onSelect(entry.code);
                }}
                onToggleFavorite={() => toggle(entry.code)}
              />
            ))}
          </section>
        ))}

        {empty && (
          <div className="flex flex-col items-center gap-1.5 px-5 py-[34px]">
            <span className="text-[15px] font-medium">{t("emptyTitle")}</span>
            <span className="text-center text-[13px] text-pretty text-muted-foreground">
              {t("emptyBody")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The clear button appears only once there is something to clear, and fades
 * rather than popping in — it sits beside a caret, and a control that
 * materialises next to one reads as a mistake.
 */
function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("currencyPicker");

  return (
    <div className="flex h-11 items-center gap-2.5 rounded-[14px] bg-foreground/5 px-3 inset-ring inset-ring-foreground/10">
      <Search
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchLabel")}
        autoComplete="off"
        // 16px on a phone or Safari zooms the sheet in on focus and never
        // zooms back out. The 15px the design asks for comes back from `md:`.
        className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-[15px]"
      />
      <button
        type="button"
        onClick={() => onChange("")}
        tabIndex={value === "" ? -1 : undefined}
        aria-hidden={value === ""}
        className={cn(
          "flex size-[26px] shrink-0 items-center justify-center rounded-full bg-foreground/8 text-foreground/85 transition-[opacity,background-color] duration-150 hover:bg-foreground/14",
          value === "" ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        <X aria-hidden="true" className="size-[11px]" strokeWidth={2} />
        <span className="sr-only">{t("clear")}</span>
      </button>
    </div>
  );
}

/**
 * The whole row selects; the star is a button inside it.
 *
 * Two real buttons side by side rather than one row with a nested control —
 * nesting them is invalid, and it is the star that suffers, because a browser
 * that flattens the markup is free to decide the outer one was pressed.
 */
function CurrencyRow({
  entry,
  selected,
  favorite,
  onSelect,
  onToggleFavorite,
}: {
  entry: CurrencyEntry;
  selected: boolean;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  const t = useTranslations("currencyPicker");

  return (
    <div
      className={cn(
        "flex h-14 items-center gap-3 rounded-[14px] pr-2 pl-2.5 transition-[background-color,box-shadow] duration-150",
        selected
          ? "bg-primary/12 inset-ring inset-ring-primary/45"
          : "hover:bg-foreground/6",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span
          aria-hidden="true"
          className="flex w-[26px] shrink-0 justify-center text-[22px] leading-none"
        >
          {entry.flag}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span
            className={cn(
              "flex items-center gap-1.5 text-[15px] font-semibold tracking-[0.01em]",
              selected && "text-primary",
            )}
          >
            {entry.code}
            {entry.symbol && (
              <span className="text-[13px] font-medium text-muted-foreground">
                {entry.symbol}
              </span>
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {entry.name}
          </span>
        </span>
        {/* The slot is kept whether or not it is filled, so a row does not
            shift sideways the moment it becomes the chosen one. */}
        <span className="flex size-5 shrink-0 items-center justify-center text-primary">
          <Check
            aria-hidden="true"
            strokeWidth={2.4}
            className={cn("size-4", selected ? "opacity-100" : "opacity-0")}
          />
        </span>
      </button>

      <button
        type="button"
        onClick={onToggleFavorite}
        aria-pressed={favorite}
        className={cn(
          "flex size-[34px] shrink-0 items-center justify-center rounded-full transition-colors duration-150 hover:bg-foreground/8",
          favorite ? "text-primary" : "text-muted-foreground/85",
        )}
      >
        <Star
          aria-hidden="true"
          strokeWidth={1.6}
          className={cn("size-4", favorite && "fill-current")}
        />
        <span className="sr-only">
          {favorite
            ? t("unfavorite", { code: entry.code })
            : t("favorite", { code: entry.code })}
        </span>
      </button>
    </div>
  );
}

interface Section {
  readonly title: string;
  readonly items: readonly CurrencyEntry[];
}

/**
 * Two shapes, depending on whether anybody is searching.
 *
 * Idle, the list is favourites then everything else, and a favourite appears
 * once — pinning a currency and then leaving it in the alphabet as well would
 * make the list look like it had failed to notice.
 *
 * Searching, grouping is noise: there is one section, it says how many matched,
 * and favourites lead it because a currency somebody starred is the one they
 * are most likely to have been reaching for.
 */
function buildSections(
  catalogue: readonly CurrencyEntry[],
  favorites: readonly string[],
  query: string,
  t: ReturnType<typeof useTranslations<"currencyPicker">>,
): readonly Section[] {
  const matches = searchCurrencies(catalogue, query);

  if (query.trim() !== "") {
    if (matches.length === 0) return [];
    const starred = matches.filter((entry) => favorites.includes(entry.code));
    const rest = matches.filter((entry) => !favorites.includes(entry.code));
    return [
      {
        title: t("results", { count: matches.length }),
        items: [...starred, ...rest],
      },
    ];
  }

  const byCode = new Map(catalogue.map((entry) => [entry.code, entry]));
  const starred = favorites
    .map((code) => byCode.get(code))
    .filter((entry): entry is CurrencyEntry => entry !== undefined);
  const rest = [...catalogue]
    .filter((entry) => !favorites.includes(entry.code))
    .sort((a, b) => a.code.localeCompare(b.code));

  return [
    ...(starred.length > 0 ? [{ title: t("favorites"), items: starred }] : []),
    { title: t("allCurrencies"), items: rest },
  ];
}
