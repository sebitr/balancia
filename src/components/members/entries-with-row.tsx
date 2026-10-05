import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, Receipt } from "lucide-react";
import { PUSH } from "@/components/motion/transitions";
import { filterParams, NO_FILTER } from "@/components/expenses/list-filter";
import { withQuery } from "@/components/expenses/list-query";

/**
 * The way from a person to the entries that make up their number.
 *
 * Somebody looking at "You owe Marta CHF 960.84" and wondering why has, until
 * now, had to go to Transactions and read the whole group's history for the
 * rows with Marta on them. This opens that list already narrowed to her —
 * every entry she paid for or carries a share of, and every repayment she
 * made or received — through the list's own `with` filter, so the sheet shows
 * it switched on and one tap on Reset takes it off again.
 *
 * Drawn as the overview's Activity row is — icon, title, caption, chevron —
 * because it is the same kind of thing: a screen this one hands the detail
 * to.
 */
export function EntriesWithRow({
  groupId,
  participantId,
  name,
  viewingSelf,
}: {
  groupId: string;
  participantId: string;
  name: string;
  viewingSelf: boolean;
}) {
  const t = useTranslations("memberStats");

  const href = withQuery(
    `/groups/${groupId}/expenses`,
    filterParams({ ...NO_FILTER, people: [participantId] }).toString(),
  );
  const title = viewingSelf ? t("entriesYours") : t("entriesWith", { name });
  const caption = viewingSelf
    ? t("entriesYoursCaption")
    : t("entriesWithCaption", { name });

  return (
    <Link
      href={href}
      transitionTypes={PUSH}
      // Two stacked spans run together in an accessible name with nothing
      // between them; see the Activity row.
      aria-label={`${title} · ${caption}`}
      className="flex min-h-12 items-center gap-2.5 rounded-2xl bg-card px-4 py-2.5 ring-1 ring-border transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
    >
      <Receipt
        aria-hidden="true"
        className="size-[17px] shrink-0 text-primary-ink"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium">{title}</span>
        <span className="text-xs text-pretty text-muted-foreground">
          {caption}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}
