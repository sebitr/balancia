import { currencyFlag } from "@/modules/currencies/catalog";
import { cn } from "@/lib/utils";

/**
 * The currency a block of figures is in, with the flag of the country behind
 * it.
 *
 * Three screens stack one currency's numbers above another's — the position
 * sheet, a group's statistics and a member's — and each said so with three
 * uppercase letters in the smallest size the scale has, which is what the eye
 * skips on the way to the figures. The flag is what it stops on instead.
 *
 * The letters stay: a flag cannot say which of a country's currencies this is,
 * and the ones standing in for a currency union are a continent or an island
 * rather than a country at all.
 */
export function CurrencyHeading({
  currency,
  /** `p` unless the block it opens is a section with a heading level. */
  as: Tag = "p",
  className,
}: {
  currency: string;
  as?: "h3" | "h4" | "p";
  className?: string;
}) {
  return (
    <Tag
      className={cn(
        "flex items-center gap-1.5 text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase",
        className,
      )}
    >
      {/* Sized a step above the letters it sits beside, the way the picker's
          rows and the currency field both size theirs: it is read as a picture
          and disappears at label size. */}
      <span aria-hidden="true" className="text-sm leading-none">
        {currencyFlag(currency)}
      </span>
      {currency}
    </Tag>
  );
}
