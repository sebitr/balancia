import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/money/amount";

/**
 * The one thing a guest cannot see for themselves: their access lives in this
 * browser's cookie and nowhere else.
 *
 * It names what an account would keep — the group, the balance, the expenses
 * they added — because "create an account" means nothing next to a list of
 * what is at stake. It is a `status` region rather than an alert or a dialog:
 * permanent, never dismissible while the session is a guest session, and gone
 * the moment the account exists.
 */
export async function GuestAccountWidget({
  groupName,
  balance,
  contributionCount,
}: {
  groupName: string;
  /** The guest's own position, in the currency they have most at stake in. */
  balance: { minorUnits: string; currency: string } | null;
  contributionCount: number;
}) {
  const t = await getTranslations("guestWidget");

  const amount = balance ? (
    <Amount
      minorUnits={balance.minorUnits}
      currency={balance.currency}
      className="font-medium text-foreground"
    />
  ) : null;

  return (
    <Alert
      role="status"
      className="gap-y-2 border-primary/30 bg-primary/6 px-4 py-3"
    >
      <Info aria-hidden="true" className="text-primary-ink" />
      <AlertTitle className="text-foreground">
        {t("title", { group: groupName })}
      </AlertTitle>
      <AlertDescription>
        {amount === null
          ? t("bodyPlain", { group: groupName })
          : contributionCount === 0
            ? t.rich("bodyBalance", {
                group: groupName,
                balance: () => amount,
              })
            : t.rich("bodyBalanceExpenses", {
                group: groupName,
                count: contributionCount,
                balance: () => amount,
              })}
      </AlertDescription>
      {/* Outside the description, in the same column as it: AlertDescription
          underlines every anchor within, which is right for a link in prose
          and wrong for a button. */}
      <div className="mt-1.5 group-has-[>svg]/alert:col-start-2">
        <Button asChild>
          <Link href="/register">{t("cta")}</Link>
        </Button>
      </div>
    </Alert>
  );
}
