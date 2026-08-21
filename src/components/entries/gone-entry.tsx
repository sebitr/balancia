"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { POP } from "@/components/motion/transitions";

/**
 * An entry that is not there any more, said properly.
 *
 * The two detail screens call `notFound()` when their entry has gone, and
 * without a boundary of their own that answer is the whole-page 404 — a screen
 * with no group, no tab bar, and nothing to do but start again from the
 * homepage. Fair enough for a mistyped URL, except that the commonest way to
 * reach a removed entry is to press back after removing it: a conversion
 * writes the entry into the other table and leaves its old address in the
 * history, one gesture behind.
 *
 * So this sits at the segment instead, and a `not-found` boundary renders
 * inside its segment's layouts — which here is the group's own shell. The tab
 * bar is already on screen, the group is still around it, and the way on is a
 * sentence rather than a dead end.
 */
export function GoneEntry() {
  const t = useTranslations("transactionDetail.gone");
  const transactions = transactionsPath(usePathname());

  return (
    <EmptyState
      icon={Receipt}
      title={t("title")}
      description={t("body")}
      action={
        transactions && (
          <Button asChild>
            <Link href={transactions} transitionTypes={POP}>
              {t("action")}
            </Link>
          </Button>
        )
      }
    />
  );
}

/**
 * The group's transaction list, read off the address of the entry that is gone.
 *
 * From the path rather than `useParams`, because a `not-found` boundary is
 * given no params of its own and reading them there is a promise nobody made.
 * The path is the one thing it certainly has.
 *
 * Null when the address is not inside a group at all, in which case the button
 * is left off: the group's tab bar is on screen either way, and a link to
 * `/groups/undefined` would be worse than no link.
 */
export function transactionsPath(pathname: string | null): string | null {
  const group = /^\/groups\/([^/]+)/.exec(pathname ?? "");
  return group ? `/groups/${group[1]}/expenses` : null;
}
