"use client";

import { useTranslations } from "next-intl";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { TONE, toneFor } from "@/components/money/balance-tone";
import { cn } from "@/lib/utils";

/**
 * Where one member stands, in one currency.
 *
 * The headline is whichever figure the reader came for. On your own row that
 * is your net across the group; on somebody else's it is the single amount
 * between the two of you, and their net across the group moves down into a
 * sub-cell where it is context rather than the answer.
 *
 * Colour never carries the meaning alone: the amount has an arrow, and under
 * it the sentence it stands for — "You owe Marta", "Marta owes you". The
 * sentence used to be read out and never drawn, on the grounds that the
 * eyebrow already said whose position it was. But "Between you two" says who,
 * not which way, and a sighted reader was left with a red figure and an arrow
 * to decode. It is the dashboard's caption, indented under the figure the same
 * way.
 *
 * The arrow is the app's one pair: down and to the left for money coming to
 * the person the sentence is about, up and to the right for money going out.
 * It used to point straight up for a positive balance here and straight down
 * for a negative one, so the same debt turned its arrow over between the group
 * screen and this one.
 *
 * Settled up is a sentence and not a figure: "0.00" invites the reader to look
 * for what it refers to.
 */

/** Which of three readers is looking, which decides all of the copy. */
export type PositionMode = "self" | "between" | "member";

export interface PositionView {
  readonly currency: string;
  /** Signed minor units: positive means the group owes them. */
  readonly net: string;
  /** Signed the reader's way: positive means this member would pay them. */
  readonly between: string;
  /** What everyone who would pay them owes, as a magnitude. */
  readonly owedBy: string;
  /** What they would pay out, as a magnitude. */
  readonly owes: string;
  readonly owedByCount: number;
  readonly owesCount: number;
  /** Everybody on either side of a simplified transfer with them. */
  readonly openCount: number;
  readonly openTotal: string;
  /** Whoever they owe the most, for the sentence that names one person. */
  readonly largestDebtTo: string | null;
}

/** Each reader's sentence, one per direction, in whole messages. */
const SENTENCES = {
  self: {
    positive: "heroYouGetBack",
    negative: "heroYouOwe",
    neutral: "heroYouSettled",
  },
  between: {
    positive: "heroOwesYou",
    negative: "heroYouOweThem",
    neutral: "heroBetweenSettled",
  },
  member: {
    positive: "heroGetsBack",
    negative: "heroOwes",
    neutral: "heroSettled",
  },
} as const;

export function MemberPosition({
  position,
  groupName,
  name,
  mode,
}: {
  position: PositionView;
  groupName: string;
  name: string;
  mode: PositionMode;
}) {
  const t = useTranslations("memberStats");

  const headline = BigInt(mode === "between" ? position.between : position.net);
  const tone = toneFor(headline.toString());
  const magnitude = headline < 0n ? -headline : headline;

  const sentence = t(SENTENCES[mode][tone], { name });
  const Arrow = tone === "positive" ? ArrowDownLeft : ArrowUpRight;

  return (
    <section className="flex flex-col gap-3 rounded-[17px] bg-card p-3.5 shadow-[0_0_0_1px_var(--border)]">
      <h2 className="text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {mode === "self"
          ? t("eyebrowSelf", { group: groupName })
          : mode === "between"
            ? t("eyebrowBetween")
            : t("eyebrowMember", { name })}
      </h2>

      {tone === "neutral" ? (
        <p
          className={cn(
            "text-xl font-semibold tracking-[-0.02em]",
            TONE.neutral.ink,
          )}
        >
          {sentence}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <p
            className={cn(
              "flex items-center gap-1.5 text-2xl font-semibold tracking-[-0.02em]",
              TONE[tone].ink,
            )}
          >
            <Arrow aria-hidden="true" className="size-5 shrink-0" />
            <Amount
              minorUnits={magnitude.toString()}
              currency={position.currency}
            />
          </p>
          {/* Indented to the figure, past the arrow and its gap, so it reads
              as the figure's caption rather than as a line of its own. */}
          <p className="pl-[26px] text-sm font-medium">{sentence}</p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3">
        {mode === "between" ? (
          <>
            <SubCell
              label={t("netAcrossGroup")}
              minorUnits={position.net}
              currency={position.currency}
              tone="signed"
            />
            <SubCell
              label={t("openWith", { count: position.openCount })}
              minorUnits={position.openTotal}
              currency={position.currency}
              tone={null}
            />
          </>
        ) : (
          <>
            <SubCell
              label={
                mode === "self"
                  ? t("owedToYouBy", { count: position.owedByCount })
                  : t("owedByGroup", { count: position.owedByCount })
              }
              minorUnits={position.owedBy}
              currency={position.currency}
              tone="positive"
            />
            <SubCell
              label={
                mode === "self"
                  ? position.largestDebtTo && position.owesCount === 1
                    ? t("youStillOwe", { name: position.largestDebtTo })
                    : t("youOwePeople", { count: position.owesCount })
                  : t("stillToPay", { count: position.owesCount })
              }
              minorUnits={position.owes}
              currency={position.currency}
              tone="negative"
            />
          </>
        )}
      </dl>
    </section>
  );
}

/**
 * One of the two figures under the headline.
 *
 * `signed` is for a value whose own sign says which way it goes — a net
 * position — and shows it. The other two are magnitudes with the direction
 * already stated in the label above them, so they carry the colour and no
 * sign. Either way a zero goes grey rather than green or red: nothing
 * outstanding is not a good or a bad thing, it is the absence of one.
 */
function SubCell({
  label,
  minorUnits,
  currency,
  tone,
}: {
  label: string;
  minorUnits: string;
  currency: string;
  tone: "positive" | "negative" | "signed" | null;
}) {
  const signed = tone === "signed";
  const resolved = signed
    ? toneFor(minorUnits)
    : BigInt(minorUnits) === 0n
      ? "neutral"
      : tone;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="truncate text-2xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "truncate text-sm font-semibold",
          resolved && TONE[resolved].ink,
        )}
      >
        <Amount
          minorUnits={minorUnits}
          currency={currency}
          signDisplay={signed ? "exceptZero" : undefined}
        />
      </dd>
    </div>
  );
}
