"use client";

import { useTranslations } from "next-intl";
import { ArrowRight, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MemberAvatar, type EntryMember } from "./pills";
import type { SplitSummary } from "./entry-logic";

/**
 * Who paid, and who it divides between — as a picture.
 *
 * This row replaces two stacked member lists. In the overwhelming majority of
 * entries the default is already right, so the state is *shown* rather than
 * offered for editing: the payer's face on the left, the faces it is split
 * between on the right, an arrow saying which way the money went, and the
 * per-person figure in a strip underneath. Tapping opens the editor, and until
 * then the screen stays short enough that the primary button is on it.
 *
 * It was a sentence — "Seb paid CHF 84.60 / Split equally between 3 · 28.20
 * each" — and a sentence has to be read to be checked. Two faces and an arrow
 * are checked at a glance, which matters because this is the row people are
 * looking at when they are about to get it wrong: who paid and who is in are
 * the two facts corrected most often after an entry is saved.
 *
 * The total is not repeated here. It is 44px tall two cards above, and saying
 * it again in 14px only invites the question of whether the two are the same
 * number.
 *
 * The computed share is the point of the strip. A row that only said "split
 * equally" would make you open the sheet to learn the one number you wanted.
 */

/**
 * How many faces the stack shows before it starts counting instead.
 *
 * Four 28px avatars overlapping at -8px is 88px, which sits inside the right
 * half of the row at 360px with the count word beside it. The fifth would
 * push the word onto its own line, and a `+3` says what three more faces the
 * size of a fingernail do not.
 */
const FACES = 4;

export function SplitSummaryRow({
  payerName,
  included,
  memberCount,
  summary,
  received = false,
  onOpen,
}: {
  payerName: string;
  /** Everybody the entry is split between, in roster order. */
  included: readonly EntryMember[];
  /** How many people are in the group, for "3 of 5". */
  memberCount: number;
  summary: SplitSummary;
  /** Income was received, not paid. */
  received?: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("addEntry.split");

  const count = included.length;
  const everyone = count === memberCount;
  const shown = included.slice(0, FACES);
  const overflow = count - shown.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full overflow-hidden rounded-[17px] bg-card text-left shadow-hairline transition-colors active:bg-accent"
    >
      <span className="flex items-center gap-3 p-3.5">
        <Side label={received ? t("receivedBy") : t("paidBy")}>
          {/* Amber, matching the payer pills in the sheet this opens. Hidden
              from the name the row reports: the initial in it is the first
              letter of the word immediately after it, and "S Seb" is the
              avatar reading itself out. */}
          <span aria-hidden="true" className="flex">
            <MemberAvatar
              name={payerName}
              className="size-7"
              selected
              tone="payer"
            />
          </span>
          <span className="min-w-0 truncate text-sm font-semibold">
            {payerName}
          </span>
        </Side>

        <ArrowRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />

        <Side label={received ? t("creditedTo") : t("splitBetween")}>
          {/* Overlapping rather than spaced, so a group of four reads as one
              object — a set of people — instead of four separate facts. The
              ring is the card's own colour, which is what makes the overlap
              legible instead of a smudge. */}
          {shown.length > 0 && (
            <span aria-hidden="true" className="flex shrink-0 -space-x-2">
              {shown.map((member) => (
                <MemberAvatar
                  key={member.id}
                  name={member.displayName}
                  guest={member.guest}
                  className="size-7 ring-2 ring-card"
                  selected
                />
              ))}
            </span>
          )}
          {overflow > 0 && (
            <span
              aria-hidden="true"
              className="shrink-0 text-sm font-semibold text-muted-foreground tabular-nums"
            >
              {`+${overflow}`}
            </span>
          )}
          {count > 0 && (
            <span className="min-w-0 truncate text-sm font-semibold">
              {everyone
                ? t("everyone")
                : t("someOf", { count, total: memberCount })}
            </span>
          )}
        </Side>

        <ChevronRight
          aria-hidden="true"
          className="size-[18px] shrink-0 text-muted-foreground"
        />
      </span>

      {/*
       * The outcome, in the one place it cannot be mistaken for the total.
       *
       * Tinted rather than outlined: it is the conclusion the row above draws,
       * not a fourth thing in it. An empty split turns the strip red — a state
       * somebody chose, but not one they can save from, and the colour is
       * never the only thing saying so.
       */}
      <span
        className={cn(
          "flex items-center gap-2 px-3.5 py-2.5 text-sm",
          summary.key === "nobody"
            ? "bg-destructive/10 text-destructive-ink"
            : "bg-wash-1 text-muted-foreground",
        )}
      >
        {t(`summary.${summary.key}`, summary.params)}
      </span>
    </button>
  );
}

/**
 * One of the two halves, under its own heading.
 *
 * The headings are what stop the arrow from being the only thing saying which
 * way round this is — an arrow between two faces is a direction, not a label,
 * and "paid by" and "credited to" are not guessable from one.
 */
function Side({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">{children}</span>
    </span>
  );
}
