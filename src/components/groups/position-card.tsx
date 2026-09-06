"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Bell, Check, ChevronRight, HandCoins, Minus } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { TONE, toneFor } from "@/components/money/balance-tone";
import { RemindButton } from "@/components/reminders/remind-button";
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
import { PositionBreakdown, type PositionView } from "./position-breakdown";
import { cn } from "@/lib/utils";

export type { PositionView as PositionCardView } from "./position-breakdown";

/**
 * The first answer on the screen: the currencies the reader is not square
 * in, as figures, then the two things to do about them.
 *
 * This was a tile per currency, level ones included, over a line saying that
 * the tiles must never be added up. A reader owed USD 8.88 and square in EUR
 * met a grey "Settled EUR" tile drawn with the same weight as the green one,
 * then a sentence about conversion, before reaching a button: the card
 * explained the system instead of stating the number. Now the figure that
 * matters is the headline, a currency that has come out level is one muted
 * line naming it, and the conversion rule waits in the sheet behind "How
 * this is calculated", beside the ledgers it is about.
 *
 * The figures still cannot be added up, and the layout no longer invites it:
 * each is its own line, in its own colour, with its own sign, the way the
 * home screen stacks them.
 */
export function PositionCard({
  positions,
  groupId,
  groupName,
  senderName,
  recipients,
}: {
  positions: readonly PositionView[];
  groupId: string;
  groupName: string;
  senderName: string;
  recipients: readonly RemindRecipient[];
}) {
  const t = useTranslations("group");
  const tMoney = useTranslations("money");
  const format = useFormatter();
  const [positionOpen, setPositionOpen] = useState(false);

  const open = positions.filter(
    (position) => BigInt(position.minorUnits) !== 0n,
  );
  const level = positions.filter(
    (position) => BigInt(position.minorUnits) === 0n,
  );
  const settled = open.length === 0;
  const incoming = open.every((position) => BigInt(position.minorUnits) > 0n);
  const outgoing = open.every((position) => BigInt(position.minorUnits) < 0n);

  // One word for the lot when the figures agree on a side. When they do not,
  // the word rides with each figure instead, and the signs already differ.
  const direction = settled
    ? null
    : incoming
      ? t("youGetBack")
      : outgoing
        ? t("youOwe")
        : null;

  return (
    <>
      <section
        aria-labelledby="your-position"
        className="flex flex-col gap-3.5 rounded-2xl bg-card p-4 ring-1 ring-border"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="your-position" className="text-xs text-muted-foreground">
            {t("yourPosition")}
          </h2>

          {settled ? (
            <p
              className={cn(
                "text-[1.875rem] leading-none font-semibold tracking-[-0.025em]",
                TONE.neutral.ink,
              )}
            >
              {tMoney("settledUpBadge")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {open.map((position) => (
                <PositionFigure
                  key={position.currency}
                  position={position}
                  count={open.length}
                  worded={direction === null}
                />
              ))}
            </ul>
          )}

          {direction && (
            <p
              className={cn(
                "text-xs font-medium",
                incoming ? TONE.positive.ink : TONE.negative.ink,
              )}
            >
              {direction}
            </p>
          )}
        </div>

        {/* A currency that has come out level is named, not drawn. A "Settled
            EUR" tile beside a green one was a figure the reader had to parse
            to learn that there was nothing to parse. */}
        {!settled && level.length > 0 && (
          <p className="flex items-center gap-[5px] text-xs text-muted-foreground">
            <Minus aria-hidden="true" className="size-[15px] shrink-0" />
            {t("settledIn", {
              currencies: format.list(
                level.map((position) => position.currency),
                { type: "conjunction" },
              ),
            })}
          </p>
        )}

        {/* Wraps for the reason the hero's row does: `flex-1` cannot shrink a
            button below its own label, so a pair that does not fit overflows
            the card rather than sharing it. */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            asChild={!settled}
            disabled={settled}
            aria-disabled={settled || undefined}
            size="lg"
            className="h-10 flex-1 rounded-lg text-sm font-semibold"
          >
            {/* Settled keeps the tick — it is the one state that is done.
                The live button shows money changing hands instead. */}
            {settled ? (
              <>
                <Check aria-hidden="true" className="size-4" />
                {t("settleUp")}
              </>
            ) : (
              <Link href={`/groups/${groupId}/settle`} transitionTypes={PUSH}>
                <HandCoins aria-hidden="true" className="size-4" />
                {t("settleUp")}
              </Link>
            )}
          </Button>

          {settled ? (
            <Button
              variant="outline"
              disabled
              aria-disabled="true"
              size="lg"
              className="h-10 flex-1 rounded-lg text-sm font-medium"
            >
              <Bell aria-hidden="true" className="size-4" />
              {t("remindAll")}
            </Button>
          ) : (
            <RemindButton
              groupId={groupId}
              groupName={groupName}
              senderName={senderName}
              recipients={recipients}
              label={recipients.length === 1 ? t("remind") : t("remindAll")}
              variant="outline"
              className="h-10 flex-1 rounded-lg text-sm font-medium"
            />
          )}
        </div>

        {!settled && (
          <button
            type="button"
            onClick={() => setPositionOpen(true)}
            className="-m-2 flex min-h-11 items-center self-start rounded-lg p-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("howCalculated")}
            <ChevronRight aria-hidden="true" className="ml-0.5 size-3.5" />
          </button>
        )}
      </section>

      <Sheet open={positionOpen} onOpenChange={setPositionOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          onOpenAutoFocus={openOnContent}
          className="mx-auto max-h-[90svh] max-w-[430px] gap-0 overflow-y-auto rounded-t-[26px] bg-background px-5 pb-7 data-[side=bottom]:border-t-0"
        >
          {/* `SheetContent` draws the grabber itself on a bottom sheet. Its
              own `mb-1` is the other half of the default `gap-4`, which this
              sheet turns off to space its children by hand — so the room under
              it is stated here instead. */}
          <SheetTitle className="mt-4 text-xl font-semibold tracking-[-0.02em]">
            {t("positionSheetTitle")}
          </SheetTitle>
          {/* The rule the card used to state under its tiles. It belongs
              here, where the ledgers it is about are drawn one under the
              other — and it is the description Radix wants the sheet to
              have, so it is read out on the way in. */}
          <SheetDescription className="mt-1.5 text-sm text-pretty text-muted-foreground">
            {t("keptApart")}
          </SheetDescription>

          <div className="mt-[18px] flex flex-col gap-5">
            {positions.map((position) => (
              <PositionBreakdown
                key={position.currency}
                position={position}
                showCurrency={positions.length > 1}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * One currency the reader is not square in, as a signed figure.
 *
 * The sign is the app's own — a real plus or minus, then the figure — and the
 * colour follows it, so the direction survives greyscale. The word is there
 * for a screen reader only when the card has not already said it once for
 * every figure.
 */
function PositionFigure({
  position,
  count,
  worded,
}: {
  position: PositionView;
  count: number;
  worded: boolean;
}) {
  const t = useTranslations("group");
  const tone = toneFor(position.minorUnits);

  // The type steps down as the list grows, as the home screen's does, so
  // three currencies still sit in about the room one figure would take.
  const size = count <= 2 ? "text-[2.125rem]" : "text-[1.625rem]";

  return (
    <li>
      <Amount
        minorUnits={position.minorUnits}
        currency={position.currency}
        display="code"
        signDisplay="exceptZero"
        className={cn(
          size,
          "leading-none font-semibold tracking-[-0.035em]",
          TONE[tone].ink,
        )}
      />
      {worded && (
        <span className="sr-only">
          {" "}
          {tone === "positive" ? t("youGetBack") : t("youOwe")}
        </span>
      )}
    </li>
  );
}
