"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Banknote, ChevronRight } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { TONE } from "@/components/money/balance-tone";
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
  const tSettle = useTranslations("settleUp");
  const [active, setActive] = useState<SettlementSuggestionView | null>(null);

  if (suggestions.length === 0) return null;

  /**
   * The transfer as a sentence, from the reader's side of it.
   *
   * It was two faces and an arrow — "Ada → Marta" — which said nothing about
   * which of the two was the reader, even when it was Ada reading. These are
   * the settle-up screen's words, so the screen this list leads to says the
   * same thing back.
   */
  const sentenceFor = (suggestion: SettlementSuggestionView) =>
    suggestion.fromIsSelf
      ? tSettle("youPayBack", { name: suggestion.toName })
      : suggestion.toIsSelf
        ? tSettle("personRepaysYou", { name: suggestion.fromName })
        : tSettle("paysBack", {
            from: suggestion.fromName,
            to: suggestion.toName,
          });

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
            className="-my-2 rounded-lg px-2 py-2 text-xs font-medium text-primary-ink transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("viewAll")}
          </Link>
        </div>

        <ul className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          {suggestions.map((suggestion, index) => {
            const key = `${suggestion.fromParticipantId}-${suggestion.toParticipantId}-${suggestion.currency}-${index}`;
            const surface =
              "flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-wash-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0";
            // The settle-up screen's colours for the same three cases: what
            // the reader pays out, what comes back to them, and a debt that is
            // neither, which is not theirs to read as good or bad news.
            const tone = suggestion.fromIsSelf
              ? TONE.negative.ink
              : suggestion.toIsSelf
                ? TONE.positive.ink
                : TONE.neutral.ink;
            const inside = (
              <>
                {/* Dimmed between two other people, as the settle-up screen
                    dims its "Not your concern" rows. */}
                <Avatar
                  className={cn(
                    "size-7 shrink-0",
                    !suggestion.fromIsSelf &&
                      !suggestion.toIsSelf &&
                      "opacity-60",
                  )}
                >
                  <AvatarFallback className="bg-accent text-2xs font-semibold text-accent-foreground">
                    {/* The other party: on the reader's own row their own
                        initial would say nothing. */}
                    {initialOf(
                      suggestion.fromIsSelf
                        ? suggestion.toName
                        : suggestion.fromName,
                    )}
                  </AvatarFallback>
                </Avatar>
                {/* Wraps rather than truncating: two names and a verb do not
                    always fit beside a figure on a phone, and the end of the
                    sentence is the receiver — the half that says where the
                    money goes. */}
                <span className="min-w-0 flex-1 text-sm font-medium wrap-anywhere">
                  {sentenceFor(suggestion)}
                </span>
                <Amount
                  minorUnits={suggestion.minorUnits}
                  currency={suggestion.currency}
                  className={cn("shrink-0 text-sm font-semibold", tone)}
                />
                <ChevronRight
                  aria-hidden="true"
                  className="-ml-1 size-4 shrink-0 text-muted-foreground"
                />
              </>
            );

            return (
              <li key={key} className="border-t first:border-t-0">
                {/* The reader's own debt is the one they can act on, so its row
                    is the action: straight into the drawer, prefilled. Anybody
                    else's opens the sheet, which is where the little that can
                    be done about someone else's debt lives. Both open
                    something, so both carry the chevron that says so. */}
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
          className="mx-auto max-w-[430px] gap-0 rounded-t-[26px] bg-background px-5 pb-7 data-[side=bottom]:border-t-0"
        >
          {/* The grabber comes from `SheetContent`; `gap-0` above means the
              room under it has to be stated rather than inherited. */}
          {active && (
            <>
              <SheetTitle className="mt-4 text-xl font-semibold tracking-[-0.02em]">
                {sentenceFor(active)}
              </SheetTitle>
              <SheetDescription className="mt-1 text-xs">
                {t("settlementDetailDescription")}
              </SheetDescription>

              <div className="mt-5 flex items-center gap-3 rounded-2xl bg-wash-2 p-4">
                <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-primary-ink">
                  <Banknote aria-hidden="true" className="size-[18px]" />
                </span>
                <Amount
                  minorUnits={active.minorUnits}
                  currency={active.currency}
                  className="text-xl font-semibold tracking-[-0.02em]"
                />
              </div>

              <div className="mt-4 flex flex-col gap-2">
                {/* Recording dismisses this sheet on its way out, the way the
                    dashboard's group picker dismisses itself once a group is
                    chosen. What it opens is another modal — the add-entry
                    drawer, over this same group — and a sheet left open
                    underneath it is invisible until the drawer is closed, at
                    which point its overlay is the topmost thing on the screen.
                    Every tap on the group then lands on that overlay instead:
                    the bottom bar's Add stops opening the drawer, and so does
                    everything else, with nothing on screen to say why. */}
                <Button
                  asChild
                  className="h-[46px] w-full rounded-[13px] font-semibold"
                >
                  <Link
                    href={recordHref(active)}
                    onClick={() => setActive(null)}
                  >
                    {t("recordPayment")}
                  </Link>
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

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}
