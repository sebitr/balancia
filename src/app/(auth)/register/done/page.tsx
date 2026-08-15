import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Check, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/money/amount";
import { requireGroupAccess } from "@/lib/actions";
import { getCurrentUser } from "@/lib/security/actor";
import {
  countContributions,
  listContributions,
} from "@/modules/guests/service";
import { loadGroupOverview } from "@/modules/groups/overview";

/**
 * What survived the sign-up.
 *
 * A guest hands over an identity that was only ever a cookie, so the screen
 * that follows has one job: show, line by line, that nothing was dropped on
 * the way — the group, the balance, the expenses they added — and say plainly
 * that the old link is now dead, because it is the other half of the same
 * promise.
 *
 * Reached only from the register form, which knows the group the claim carried
 * across. Anything else about the URL — no group, a group this account is not
 * a member of — is not an error worth a screen; it is the dashboard.
 */

/** Enough to prove the point; the expense list is a tap away. */
const KEPT_ROWS = 5;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("registerDone");
  return { title: t("metaTitle") };
}

export default async function RegisterDonePage({
  searchParams,
}: PageProps<"/register/done">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { group } = await searchParams;
  if (typeof group !== "string") redirect("/dashboard");

  const access = await requireGroupAccess(group).catch(() => null);
  if (!access?.participantId) redirect("/dashboard");

  const [overview, kept, keptTotal] = await Promise.all([
    loadGroupOverview(access),
    listContributions(access.participantId, { limit: KEPT_ROWS }),
    countContributions(access.participantId),
  ]);

  const t = await getTranslations("registerDone");
  const position = overview.positions[0] ?? null;

  return (
    <div className="flex min-h-[70dvh] flex-col justify-between gap-8">
      <div className="flex flex-col gap-4">
        <span className="flex size-12 items-center justify-center rounded-full bg-positive/15 text-positive">
          <Check aria-hidden="true" className="size-6" />
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {t("title", { name: user.name })}
          </h1>
          <p className="text-sm text-pretty text-muted-foreground">
            {t("body", { group: access.group.name })}
          </p>
        </div>

        <ul className="overflow-hidden rounded-lg border">
          <li className="flex min-h-11 items-center justify-between gap-3 px-3 py-3">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">
                {access.group.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("memberSince")}
              </span>
            </span>
            {position && (
              <Amount
                minorUnits={position.amount.toString()}
                currency={position.currency}
                className="text-sm font-medium"
              />
            )}
          </li>

          {kept.map((expense) => (
            <li
              key={expense.id}
              className="flex min-h-11 items-center justify-between gap-3 border-t px-3 py-3"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {expense.description}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("expenseYouAdded")}
                </span>
              </span>
              <Badge variant="secondary">{t("kept")}</Badge>
            </li>
          ))}

          {keptTotal > kept.length && (
            <li className="border-t px-3 py-2.5 text-xs text-muted-foreground">
              {t("keptMore", { count: keptTotal - kept.length })}
            </li>
          )}
        </ul>

        <p className="flex items-start gap-2 rounded-lg border bg-popover px-3.5 py-3 text-[0.8125rem] text-muted-foreground shadow-raised">
          <Mail aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t("linkRetired")}
        </p>
      </div>

      <Button asChild size="lg">
        <Link href={`/groups/${access.groupId}`}>
          {t("goToGroup", { group: access.group.name })}
        </Link>
      </Button>
    </div>
  );
}
