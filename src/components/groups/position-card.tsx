"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, Check, ChevronRight, Minus, Plus } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { toneFor, type BalanceTone } from "@/components/money/balance-tone";
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

/** Tint, label colour and arithmetic sign, one row per direction. */
const TILE: Record<
  BalanceTone,
  { readonly fill: string; readonly ink: string }
> = {
  positive: { fill: "bg-positive/10", ink: "text-positive" },
  negative: { fill: "bg-negative/10", ink: "text-negative" },
  neutral: { fill: "bg-muted", ink: "text-neutral-balance" },
};

/**
 * The first answer on the screen: one tile per currency, then the two things
 * to do about them.
 *
 * A single hero amount used to sit here, which works for one currency and
 * falls apart at four — the screen either picked a currency to shout and
 * buried the rest, or stacked four heroes and became a wall. A tile grid is
 * flat: every currency gets the same room, the reader's eye finds the red one,
 * and the card's height grows by a row per pair rather than by a screenful.
 *
 * The footnote is load-bearing, not decoration. Four amounts in a grid invite
 * being added up, and these four can never be added up; the line under them is
 * what says so.
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
  const [positionOpen, setPositionOpen] = useState(false);

  // Settled currencies are counted and shown: "across 4 currencies" is a
  // statement about where this group has been active, and dropping the square
  // ones would make the number shrink as the reader settles up.
  const settled = positions.every(
    (position) => BigInt(position.minorUnits) === 0n,
  );

  return (
    <>
      <section
        aria-labelledby="your-position"
        className="flex flex-col gap-3.5 rounded-2xl bg-card p-4 ring-1 ring-border"
      >
        <h2 id="your-position" className="sr-only">
          {t("yourPosition")}
        </h2>

        <p className="text-xs text-muted-foreground">
          {t("positionAcross", { count: positions.length })}
        </p>

        <ul className="grid grid-cols-2 gap-2">
          {positions.map((position) => (
            <PositionTile key={position.currency} position={position} />
          ))}
        </ul>

        {/* Why four amounts in a grid are not a total. */}
        <p className="text-2xs text-pretty text-muted-foreground">
          {t("keptApart")}
        </p>

        <div className="flex items-center gap-2.5">
          <Button
            asChild={!settled}
            disabled={settled}
            aria-disabled={settled || undefined}
            size="lg"
            className="h-10 flex-1 rounded-lg text-sm font-semibold"
          >
            {settled ? (
              <>
                <Check aria-hidden="true" className="size-4" />
                {t("settleUp")}
              </>
            ) : (
              <Link href={`/groups/${groupId}/settle`} transitionTypes={PUSH}>
                <Check aria-hidden="true" className="size-4" />
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
              label={
                recipients.length === 1
                  ? t("remindPerson", { name: recipients[0].name })
                  : t("remindAll")
              }
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
          className="mx-auto max-h-[90svh] max-w-[430px] gap-0 overflow-y-auto rounded-t-[26px] bg-background px-5 pt-2.5 pb-7 data-[side=bottom]:border-t-0"
        >
          {/* `SheetContent` draws the grabber itself on a bottom sheet. Its
              own `mb-1` is the other half of the default `gap-4`, which this
              sheet turns off to space its children by hand — so the room under
              it is stated here instead. */}
          <SheetTitle className="mt-4 text-xl font-semibold tracking-[-0.02em]">
            {t("positionSheetTitle")}
          </SheetTitle>
          {/* The three subtotals explain the sheet now; this stays for the
              screen reader, which Radix requires to have something to name. */}
          <SheetDescription className="sr-only">
            {t("positionSheetDescription")}
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
 * One currency's standing, in a tinted tile.
 *
 * The amount is unsigned and the sign is a separate glyph beside it, so the
 * direction survives greyscale and a screen reader reads the word rather than
 * a minus. A settled tile carries neither: it names the currency under the
 * word "Settled" and stops, because "GBP 0.00" is a figure the reader has to
 * parse to learn that there is nothing to parse.
 */
function PositionTile({ position }: { position: PositionView }) {
  const t = useTranslations("money");
  const tone = toneFor(position.minorUnits);
  const value = BigInt(position.minorUnits);
  const magnitude = value < 0n ? -value : value;

  const label =
    tone === "positive"
      ? t("getsBack")
      : tone === "negative"
        ? t("owes")
        : t("settled");

  return (
    <li
      className={cn(
        "flex flex-col gap-0.5 rounded-lg px-[11px] py-[9px]",
        TILE[tone].fill,
      )}
    >
      <span
        className={cn(
          "text-2xs font-semibold tracking-[0.07em] uppercase",
          TILE[tone].ink,
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "flex items-center gap-[5px] text-base leading-none font-semibold tracking-[-0.01em]",
          TILE[tone].ink,
        )}
      >
        {tone !== "neutral" &&
          (tone === "positive" ? (
            <Plus
              aria-hidden="true"
              strokeWidth={2.2}
              className="size-[15px] shrink-0"
            />
          ) : (
            <Minus
              aria-hidden="true"
              strokeWidth={2.2}
              className="size-[15px] shrink-0"
            />
          ))}
        {tone === "neutral" ? (
          <span>{position.currency}</span>
        ) : (
          // The code travels with the number rather than being set beside
          // it: which side it belongs on is the locale's call, and Intl is
          // the only thing here that knows.
          <Amount
            minorUnits={magnitude.toString()}
            currency={position.currency}
            display="code"
          />
        )}
      </span>
    </li>
  );
}
