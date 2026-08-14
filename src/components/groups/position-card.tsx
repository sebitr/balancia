import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/money/amount";
import { RemindButton } from "@/components/reminders/remind-button";
import type { RemindRecipient } from "@/modules/reminders/types";
import { cn } from "@/lib/utils";
import { PUSH } from "@/components/motion/transitions";

/**
 * Where the reader stands, and the two things they can do about it.
 *
 * The figure is the point of the screen, so it is the largest thing on it. Its
 * direction is carried three ways at once — the word above it, the arrow beside
 * it and the colour — because colour alone survives neither greyscale nor a
 * screen reader.
 *
 * Being square is a result, not a zero: it is phrased, and both actions go away
 * with it, because there is nothing left to settle or to ask for.
 */

export interface PositionView {
  readonly currency: string;
  /** Signed minor units: positive means the reader is owed. */
  readonly minorUnits: string;
  /** Who would pay, or be paid, to clear it. Ordered by amount. */
  readonly counterparties: readonly { name: string; minorUnits: string }[];
}

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
  /** The reader's own name, which the drafts refer to in the third person. */
  senderName: string;
  /** Everyone who owes the reader — empty when there is nobody to ask. */
  recipients: readonly RemindRecipient[];
}) {
  const t = useTranslations("group");
  const format = useFormatter();

  const open = positions.filter(
    (position) => BigInt(position.minorUnits) !== 0n,
  );
  const settled = open.length === 0;
  // One currency is the ordinary case and gets the designed sentence. Several
  // have no single direction, so the label steps back and each row speaks.
  const single = open.length === 1 ? open[0] : null;
  const owedAnywhere = open.some(
    (position) => BigInt(position.minorUnits) > 0n,
  );

  const label = settled
    ? t("settledPosition")
    : single
      ? BigInt(single.minorUnits) > 0n
        ? t("youGetBack")
        : t("youOwe")
      : t("yourPositionMixed");

  return (
    <section
      aria-labelledby="your-position"
      className="flex flex-col gap-3.5 rounded-[17px] bg-card p-4 ring-1 ring-border"
    >
      <h2 id="your-position" className="text-[0.8125rem] text-muted-foreground">
        {label}
      </h2>

      {settled ? (
        <p className="flex items-center gap-2 text-[2.125rem] leading-none font-semibold tracking-[-0.02em] text-neutral-balance">
          <Minus aria-hidden="true" className="size-6 shrink-0" />
          <span className="text-[1.75rem]">{t("nothingOutstanding")}</span>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {open.map((position) => {
            const owed = BigInt(position.minorUnits) > 0n;
            const magnitude = owed
              ? position.minorUnits
              : (-BigInt(position.minorUnits)).toString();
            const Icon = owed ? ArrowDownLeft : ArrowUpRight;

            return (
              <p
                key={position.currency}
                className={cn(
                  "flex items-center gap-2",
                  owed ? "text-positive" : "text-negative",
                )}
              >
                <Icon aria-hidden="true" className="size-[26px] shrink-0" />
                <Amount
                  minorUnits={magnitude}
                  currency={position.currency}
                  className="text-[2.125rem] leading-none font-semibold tracking-[-0.02em]"
                />
                {/* One currency is already named by the heading above, and
                    saying it twice only makes a screen reader repeat itself.
                    Several currencies have no shared direction, so each row
                    states its own — in words, not just in colour. */}
                {!single && (
                  <span className="text-sm">
                    {owed ? t("youGetBack") : t("youOwe")}
                  </span>
                )}
              </p>
            );
          })}
        </div>
      )}

      {single && single.counterparties.length > 0 && (
        <p className="text-[0.8125rem] text-muted-foreground">
          {BigInt(single.minorUnits) > 0n
            ? t("fromPeople", {
                names: format.list(
                  single.counterparties.map((party) => party.name),
                  { type: "conjunction" },
                ),
              })
            : t("toPeople", {
                names: format.list(
                  single.counterparties.map((party) => party.name),
                  { type: "conjunction" },
                ),
              })}
        </p>
      )}

      {!settled && (
        <div className="flex items-center gap-2">
          <Button
            asChild
            size="lg"
            className="h-9 flex-1 rounded-xl text-sm font-medium"
          >
            <Link href={`/groups/${groupId}/balances`} transitionTypes={PUSH}>
              <ArrowRightLeft aria-hidden="true" className="size-4" />
              {t("settleUp")}
            </Link>
          </Button>
          {/* Only someone who is owed has anyone to ask. */}
          {owedAnywhere && recipients.length > 0 && (
            <RemindButton
              groupId={groupId}
              groupName={groupName}
              senderName={senderName}
              recipients={recipients}
            />
          )}
        </div>
      )}
    </section>
  );
}
