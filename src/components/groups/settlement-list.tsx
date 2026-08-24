"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Banknote } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { RemindButton } from "@/components/reminders/remind-button";
import { settleIntentPath } from "@/components/entries/settle-intent";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  openOnContent,
} from "@/components/ui/sheet";
import type { RemindRecipient } from "@/modules/reminders/types";
import { PUSH } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";

export interface SettlementSuggestionView {
  readonly fromParticipantId: string;
  readonly fromName: string;
  readonly toParticipantId: string;
  readonly toName: string;
  readonly currency: string;
  readonly minorUnits: string;
  readonly fromIsSelf: boolean;
  readonly toIsSelf: boolean;
}

/** Explicit transfers; net balances remain in the section above. */
export function SettlementList({
  suggestions,
  groupId,
  groupName,
  senderName,
  recipients,
}: {
  suggestions: readonly SettlementSuggestionView[];
  groupId: string;
  groupName: string;
  senderName: string;
  recipients: readonly RemindRecipient[];
}) {
  const t = useTranslations("group");
  const [active, setActive] = useState<SettlementSuggestionView | null>(null);

  if (suggestions.length === 0) return null;

  /**
   * Where recording this transfer goes: the add-entry drawer, over the group,
   * on the settle tab with the pair already picked. The amount is left off the
   * link on purpose — the drawer prices the debt from the balances it loads,
   * so the form opens on what is outstanding rather than on what this list
   * last rendered.
   */
  const recordHref = (suggestion: SettlementSuggestionView) =>
    settleIntentPath(groupId, {
      fromParticipantId: suggestion.fromParticipantId,
      toParticipantId: suggestion.toParticipantId,
      currency: suggestion.currency,
    });

  const activeRecipients = active
    ? recipients.filter(
        (recipient) => recipient.participantId === active.fromParticipantId,
      )
    : [];

  return (
    <>
      <section
        aria-labelledby="suggested-settlements"
        className="flex flex-col gap-2.5"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="suggested-settlements" className="text-sm font-medium">
            {t("suggestedSettlements")}
          </h2>
          {/* The settle-up screen, not the balances one. This heading is about
              transfers, and "all" of a shortened transfer list is the screen
              that writes every one of them out with its action attached —
              balances answer a different question and have their own link,
              under the list above. */}
          <Link
            href={`/groups/${groupId}/settle`}
            transitionTypes={PUSH}
            className="-my-2 rounded-lg px-2 py-2 text-xs font-medium text-primary transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("viewAll")}
          </Link>
        </div>

        <ul className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          {suggestions.map((suggestion, index) => {
            const key = `${suggestion.fromParticipantId}-${suggestion.toParticipantId}-${suggestion.currency}-${index}`;
            const surface =
              "grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0";
            const inside = (
              <>
                <SettlementPeople suggestion={suggestion} />
                <Amount
                  minorUnits={suggestion.minorUnits}
                  currency={suggestion.currency}
                  display="code"
                  className="shrink-0 text-sm font-semibold"
                />
              </>
            );

            return (
              <li key={key} className="border-t first:border-t-0">
                {/* The reader's own debt is the one they can act on, so its row
                    is the action: straight into the drawer, prefilled. Anybody
                    else's opens the sheet, which is where the little that can
                    be done about someone else's debt lives. */}
                {suggestion.fromIsSelf ? (
                  <Link href={recordHref(suggestion)} className={surface}>
                    {inside}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActive(suggestion)}
                    className={surface}
                  >
                    {inside}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <Sheet
        open={active !== null}
        onOpenChange={(open) => !open && setActive(null)}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          onOpenAutoFocus={openOnContent}
          className="mx-auto max-w-[430px] gap-0 rounded-t-[26px] bg-background px-5 pt-2.5 pb-7 data-[side=bottom]:border-t-0"
        >
          <span
            aria-hidden="true"
            className="mx-auto mb-5 block h-1 w-[38px] rounded-full bg-foreground/20"
          />
          {active && (
            <>
              <SheetTitle className="text-xl font-semibold tracking-[-0.02em]">
                {t("settlementDetailTitle", {
                  from: active.fromName,
                  to: active.toName,
                })}
              </SheetTitle>
              <SheetDescription className="mt-1 text-xs">
                {t("settlementDetailDescription")}
              </SheetDescription>

              <div className="mt-5 flex items-center gap-3 rounded-2xl bg-foreground/[0.05] p-4">
                <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-primary">
                  <Banknote aria-hidden="true" className="size-[18px]" />
                </span>
                <Amount
                  minorUnits={active.minorUnits}
                  currency={active.currency}
                  display="code"
                  className="text-xl font-semibold tracking-[-0.02em]"
                />
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <Button
                  asChild
                  className="h-[46px] w-full rounded-[13px] font-semibold"
                >
                  <Link href={recordHref(active)}>{t("recordPayment")}</Link>
                </Button>
                {active.toIsSelf && activeRecipients.length > 0 && (
                  <RemindButton
                    groupId={groupId}
                    groupName={groupName}
                    senderName={senderName}
                    recipients={activeRecipients}
                    label={t("sendReminder")}
                    variant="outline"
                    className="h-[46px] w-full rounded-[13px] font-semibold"
                  />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function SettlementPeople({
  suggestion,
}: {
  suggestion: SettlementSuggestionView;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Person name={suggestion.fromName} self={suggestion.fromIsSelf} />
      <ArrowRight
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <Person name={suggestion.toName} self={suggestion.toIsSelf} />
    </span>
  );
}

function Person({ name, self }: { name: string; self: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar className="size-7 shrink-0">
        <AvatarFallback
          className={cn(
            "text-2xs font-semibold",
            self
              ? "bg-primary/15 text-primary"
              : "bg-accent text-accent-foreground",
          )}
        >
          {name.trim().charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="max-w-[5.5rem] truncate text-xs font-medium">
        {name}
      </span>
    </span>
  );
}
