import Link from "next/link";
import { Download, Link2, Plus, ReceiptText, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PUSH } from "@/components/motion/transitions";

/** The useful first steps for a group that has not recorded money yet. */
export function GroupEmptyState({
  groupId,
  canImport,
  canInvite,
}: {
  groupId: string;
  canImport: boolean;
  canInvite: boolean;
}) {
  const t = useTranslations("group");

  return (
    <div className="flex flex-col gap-[26px]">
      <section className="flex flex-col items-center rounded-[22px] border border-dashed border-border px-5 py-9 text-center">
        <span className="flex size-[46px] items-center justify-center rounded-full bg-accent text-primary">
          <ReceiptText aria-hidden="true" className="size-5" />
        </span>
        <h1 className="mt-4 text-lg font-semibold tracking-[-0.015em]">
          {t("noExpensesTitle")}
        </h1>
        <p className="mt-1.5 max-w-[17rem] text-sm leading-relaxed text-muted-foreground">
          {t("emptyOverviewDescription")}
        </p>

        <div className="mt-5 flex w-full max-w-[18rem] flex-col gap-2">
          <Button
            asChild
            size="lg"
            className="h-[46px] rounded-[13px] font-semibold"
          >
            <Link href={`/groups/${groupId}/expenses/new`}>
              <Plus aria-hidden="true" className="size-4" />
              {t("addExpense")}
            </Link>
          </Button>
          {canImport && (
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-[46px] rounded-[13px] font-semibold"
            >
              <Link href={`/groups/${groupId}/import`} transitionTypes={PUSH}>
                <Download aria-hidden="true" className="size-4" />
                {t("importFromSplitwise")}
              </Link>
            </Button>
          )}
        </div>
      </section>

      <section
        aria-labelledby="invite-by-link"
        className="flex flex-col gap-2.5"
      >
        <h2 id="invite-by-link" className="text-sm font-medium">
          {t("inviteByLink")}
        </h2>
        <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
              <Link2 aria-hidden="true" className="size-[18px]" />
            </span>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("inviteByLinkDescription")}
            </p>
          </div>

          <Button
            asChild
            variant="outline"
            size="lg"
            className="mt-4 h-[46px] w-full rounded-[13px] border-primary/45 font-semibold text-primary hover:text-primary"
          >
            <Link href={`/groups/${groupId}/members`} transitionTypes={PUSH}>
              <Users aria-hidden="true" className="size-4" />
              {canInvite ? t("manageInviteLinks") : t("viewPeople")}
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
