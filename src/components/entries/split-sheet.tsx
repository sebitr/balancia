"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { SplitMethod } from "@/modules/expenses/split";
import type {
  SplitMessage,
  SplitPreview,
} from "@/components/expenses/expense-form-logic";
import { MemberAvatar, MemberPill, type EntryMember } from "./pills";
import type { SplitNote } from "./split-notes";

/**
 * Correcting who put the money in, and how it divides.
 *
 * Avatars instead of checkbox lists, because the corrections people actually
 * make are blunt — "Hervé paid this time", "Cyril wasn't there" — and each is
 * one tap on a face. The fiddly cases — exact amounts, percentages, weights —
 * are still available, one tab away, and only those tabs grow a numeric field
 * per person.
 *
 * Order is deliberate: Equally, Shares, Exact, Percent. The two that need no
 * typing come first.
 *
 * Income says the same things in its own words. Money that came in was
 * *received by* somebody and *credited to* the group, and calling that "paid
 * by" reads as a mistake on a screen whose whole job is who owes what.
 */

const METHODS: readonly SplitMethod[] = [
  "equal",
  "shares",
  "exact",
  "percentage",
];

export function SplitSheet({
  members,
  title,
  totalFormatted,
  payerId,
  onPayerChange,
  includedIds,
  onIncludedChange,
  method,
  onMethodChange,
  values,
  onValueChange,
  preview,
  note,
  received = false,
  splitText,
  alwaysSplit,
  onAlwaysSplitChange,
  onAddGuest,
  several = false,
  onSeveralChange,
  payerAmounts,
  onPayerAmountChange,
  payerNote,
  onJustOnePaid,
  onSplitPaymentEqually,
  onGiveRest,
  onDone,
}: {
  members: readonly EntryMember[];
  title: string;
  totalFormatted: string;
  payerId: string;
  onPayerChange: (id: string) => void;
  includedIds: readonly string[];
  onIncludedChange: (ids: readonly string[]) => void;
  method: SplitMethod;
  onMethodChange: (method: SplitMethod) => void;
  values: Readonly<Record<string, string>>;
  onValueChange: (participantId: string, value: string) => void;
  preview: SplitPreview;
  /** What the split does not add up to, if anything. */
  note: SplitNote | null;
  /** Income was received and credited, not paid and owed. */
  received?: boolean;
  /** Renders a message from the pure split logic. */
  splitText: (message: SplitMessage) => string;
  /**
   * Whether the group is remembering this split, or null when there is
   * nothing worth remembering.
   *
   * Null for equal-between-everyone, which is what a new entry already does:
   * offering to remember the default would be offering to remember nothing.
   */
  alwaysSplit: boolean | null;
  onAlwaysSplitChange: (always: boolean) => void;
  /**
   * Creates somebody with a name and no account, and puts them in the split.
   *
   * Absent when the reader may not add people to this group, which is the
   * only reason the row would not be there.
   */
  onAddGuest?: (name: string) => Promise<void>;
  /**
   * Whether more than one person put the money in.
   *
   * Absent `onSeveralChange` hides the option entirely, which is what an
   * income and a repayment get: one has a receiver, the other has a pair, and
   * neither has anything to divide the *paying* between.
   */
  several?: boolean;
  onSeveralChange?: (several: boolean) => void;
  /** Per participant, as typed. Only read while `several`. */
  payerAmounts?: Readonly<Record<string, string>>;
  onPayerAmountChange?: (participantId: string, value: string) => void;
  /**
   * What the amounts do not add up to, already worded, or null when they do.
   *
   * The balance engine refuses an expense whose contributions miss its total,
   * so this is the difference between a fixable warning and a failed save.
   */
  payerNote?: string | null;
  /** The three ways people actually fix a shortfall. */
  onJustOnePaid?: () => void;
  onSplitPaymentEqually?: () => void;
  onGiveRest?: (participantId: string) => void;
  onDone: () => void;
}) {
  const t = useTranslations("addEntry.split");

  const everyone = members.map((member) => member.id);

  // Rebuilt in member order rather than appended: the equal-split remainder is
  // handed out in this order, so a list that reordered itself on every tap
  // would quietly move who absorbs the extra cent.
  const toggle = (id: string) => {
    onIncludedChange(
      includedIds.includes(id)
        ? includedIds.filter((current) => current !== id)
        : everyone.filter(
            (current) => includedIds.includes(current) || current === id,
          ),
    );
  };

  const allocationFor = (id: string) =>
    preview.ok
      ? preview.allocations.find((entry) => entry.participantId === id)
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <SheetTitle className="text-lg font-semibold tracking-[-0.02em]">
          {title}
        </SheetTitle>
        <span className="text-sm text-muted-foreground tabular-nums">
          {totalFormatted}
        </span>
      </div>

      <section className="space-y-2">
        <h3 className="text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {t(received ? "receivedBy" : "paidBy")}
        </h3>
        {/* Wrapping pills rather than a row of equal columns: a group of ten
            would otherwise divide the width ten ways and truncate every name
            to its first letter. */}
        <div
          role="radiogroup"
          aria-label={t(received ? "receivedBy" : "paidBy")}
          className="flex flex-wrap gap-2"
        >
          {members.map((member) => (
            <MemberPill
              key={member.id}
              name={member.displayName}
              // Both halves of this sheet carry a control per person. The
              // colours tell them apart on screen; these names do it for
              // anyone who is not looking at the screen.
              label={t(received ? "receiverOption" : "payerOption", {
                name: member.displayName,
              })}
              selected={!several && member.id === payerId}
              onToggle={() => onPayerChange(member.id)}
              tone="payer"
              guest={member.guest}
              choice
            />
          ))}
          {/*
           * The last option, and dashed like every other "not one of these":
           * two people splitting a deposit at the counter is real, and it was
           * a permanent segmented control above these faces for a choice that
           * goes the other way ninety-five times in a hundred.
           */}
          {onSeveralChange && (
            <button
              type="button"
              role="radio"
              aria-checked={several}
              onClick={() => onSeveralChange(!several)}
              className={cn(
                "tap-target inline-flex h-10 items-center gap-2 rounded-full border pr-3 pl-1 text-sm transition-colors",
                several
                  ? "border-payer bg-payer/15 font-semibold text-foreground"
                  : "border-dashed border-border bg-white/4 font-normal text-muted-foreground",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-[30px] shrink-0 place-items-center rounded-full border border-dashed",
                  several ? "border-payer/40" : "border-border",
                )}
              >
                <Users className="size-4" />
              </span>
              <span className="truncate">{t("several")}</span>
            </button>
          )}
        </div>

        {several && payerAmounts && onPayerAmountChange && (
          <MultiPayerPanel
            members={members}
            amounts={payerAmounts}
            onAmountChange={onPayerAmountChange}
            note={payerNote}
            onJustOne={onJustOnePaid}
            onSplitEqually={onSplitPaymentEqually}
            onGiveRest={onGiveRest}
          />
        )}
      </section>

      <section className="space-y-2">
        {/* No "Everyone" / "Just me" shortcuts: everyone is already the state
            this sheet opens in, and the pills below reach either end in a tap
            or two. Two more controls that mostly restate the selection cost
            more attention than they save. */}
        <h3 className="text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {t(received ? "creditedTo" : "splitBetween")}
        </h3>
        <div className="flex flex-wrap gap-2">
          {members.map((member) => (
            <MemberPill
              key={member.id}
              name={member.displayName}
              label={t("includeOption", { name: member.displayName })}
              selected={includedIds.includes(member.id)}
              onToggle={() => toggle(member.id)}
              guest={member.guest}
            />
          ))}
          {/*
           * Somebody who is not on this instance and does not need to be.
           * A split should not require everyone to have the app: the flatmate
           * who never signed up is still owed their share, and inviting them
           * first is a step between a person and the entry they are trying to
           * write.
           */}
          {onAddGuest && (
            <AddGuestPill onAdd={onAddGuest} label={t("addSomeone")} />
          )}
        </div>
      </section>

      <div className="flex gap-1 rounded-xl bg-muted p-1">
        {METHODS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => onMethodChange(candidate)}
            aria-pressed={candidate === method}
            className={cn(
              "tap-target h-9 flex-1 rounded-[calc(var(--radius-xl)_-_--spacing(1))] text-xs transition-colors",
              candidate === method
                ? "bg-accent font-semibold text-foreground"
                : "font-medium text-muted-foreground",
            )}
          >
            {t(`methods.${candidate}`)}
          </button>
        ))}
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {t(`hints.${method}`)}
      </p>

      {/* The rows are a scroll container of their own past a few people, and
          they must overflow rather than compress: a squashed row is how a
          ten-person split loses its amounts. */}
      <ul className="max-h-[38vh] overflow-x-hidden overflow-y-auto rounded-[14px] bg-white/4 [&>*]:shrink-0">
        {members
          .filter((member) => includedIds.includes(member.id))
          .map((member) => {
            const allocation = allocationFor(member.id);
            return (
              <li
                key={member.id}
                className="flex h-15 items-center gap-3 border-b border-white/8 p-3 last:border-b-0"
              >
                <MemberAvatar
                  name={member.displayName}
                  selected
                  tone={member.id === payerId ? "payer" : "primary"}
                  guest={member.guest}
                />
                <span className="flex-1 truncate text-sm">
                  {member.displayName}
                </span>

                {method !== "equal" && (
                  <Input
                    inputMode="decimal"
                    aria-label={t(`inputLabels.${method}`, {
                      name: member.displayName,
                    })}
                    className={cn(
                      "h-9 text-right tabular-nums",
                      // An exact split has no allocation column beside it, so
                      // the field takes that width back rather than leaving a
                      // gap: it is the one method whose typing is an amount,
                      // and amounts are the long thing to type.
                      method === "exact" ? "w-[154px]" : "w-[72px]",
                    )}
                    placeholder={method === "shares" ? "1" : "0"}
                    value={values[member.id] ?? ""}
                    onChange={(event) =>
                      onValueChange(member.id, event.target.value)
                    }
                  />
                )}

                {/* Shares and percentages need telling what they came to; an
                    exact amount is already the number in the field, and
                    printing it twice per row reads as two different figures
                    that happen to agree. */}
                {method !== "exact" && (
                  <span className="w-[70px] text-right text-sm tabular-nums">
                    {allocation?.formatted ?? "—"}
                  </span>
                )}
              </li>
            );
          })}
      </ul>

      {/* The note says which way the split is out and by how much; the
          rounding note only has something to add when it does not. */}
      {note ? (
        <p
          className={cn(
            "text-xs",
            note.tone === "error"
              ? "text-negative-ink"
              : "text-muted-foreground",
          )}
        >
          {t(`notes.${note.key}`, note.params)}
        </p>
      ) : (
        preview.ok &&
        preview.roundingNote && (
          <p className="text-xs text-muted-foreground">
            {splitText(preview.roundingNote)}
          </p>
        )
      )}

      {/*
       * "We always split 30/30/40" is the most-asked-for thing in this
       * category, and re-entering a fixed uneven split every time is the
       * actual grind. Shown only once the split differs from
       * equal-between-everyone, because that is already what a new entry
       * does and remembering it would remember nothing.
       */}
      {alwaysSplit !== null && (
        <label className="flex min-h-[52px] items-center justify-between gap-3 rounded-2xl bg-card px-4 py-2.5 shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]">
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              {t("alwaysTitle")}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t("alwaysHint")}
            </span>
          </span>
          <Switch
            checked={alwaysSplit}
            onCheckedChange={onAlwaysSplitChange}
            aria-label={t("alwaysTitle")}
          />
        </label>
      )}

      <Button
        type="button"
        size="lg"
        className="h-13"
        // Nothing to be done with an empty split but put somebody back in it,
        // and the note above says so.
        disabled={includedIds.length === 0}
        onClick={onDone}
      >
        {t("done")}
      </Button>
    </div>
  );
}

/**
 * Who paid what, once more than one person did.
 *
 * An amount per person and the three shortcuts that fix the commonest
 * shortfalls. It sits inside the "Paid by" section rather than below the
 * split, because it answers that section's question — dividing the *paying*
 * is not dividing the *owing*, and two amount lists side by side is exactly
 * the confusion this sheet was built to remove.
 */
function MultiPayerPanel({
  members,
  amounts,
  onAmountChange,
  note,
  onJustOne,
  onSplitEqually,
  onGiveRest,
}: {
  members: readonly EntryMember[];
  amounts: Readonly<Record<string, string>>;
  onAmountChange: (participantId: string, value: string) => void;
  note?: string | null;
  onJustOne?: () => void;
  onSplitEqually?: () => void;
  onGiveRest?: (participantId: string) => void;
}) {
  const t = useTranslations("addEntry.split");

  /*
   * Who "the rest" goes to: the first person with no amount against them, or
   * the first person at all when everyone has one. It is the likeliest answer
   * and it costs a tap to change — the same trade the payer row itself makes.
   */
  const restCandidate =
    members.find((member) => (amounts[member.id] ?? "").trim() === "") ??
    members[0];

  return (
    <div className="space-y-2 rounded-2xl bg-card p-3 shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]">
      <ul>
        {members.map((member) => (
          <li
            key={member.id}
            className="flex h-13 items-center gap-3 border-b border-white/8 px-1 last:border-b-0"
          >
            <MemberAvatar
              name={member.displayName}
              selected={(amounts[member.id] ?? "").trim() !== ""}
              tone="payer"
              guest={member.guest}
            />
            <span className="flex-1 truncate text-sm">
              {member.displayName}
            </span>
            <Input
              value={amounts[member.id] ?? ""}
              onChange={(event) =>
                onAmountChange(member.id, event.target.value)
              }
              inputMode="decimal"
              placeholder="0.00"
              aria-label={t("payerAmount", { name: member.displayName })}
              className="h-9 w-24 text-right tabular-nums"
            />
          </li>
        ))}
      </ul>

      {/*
       * Not decoration: the balance engine refuses an expense whose
       * contributions miss its total, so this line is the difference between
       * something fixable and a failed save.
       */}
      {note && <p className="px-1 text-xs text-destructive-ink">{note}</p>}

      <div className="flex flex-wrap gap-1.5">
        {onJustOne && (
          <ShortcutButton onClick={onJustOne}>
            {t("justOnePaid")}
          </ShortcutButton>
        )}
        {onSplitEqually && (
          <ShortcutButton onClick={onSplitEqually}>
            {t("splitPayment")}
          </ShortcutButton>
        )}
        {onGiveRest && restCandidate && (
          <ShortcutButton onClick={() => onGiveRest(restCandidate.id)}>
            {t("giveRest", { name: restCandidate.displayName })}
          </ShortcutButton>
        )}
      </div>
    </div>
  );
}

function ShortcutButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap-target h-9 rounded-lg border border-border bg-white/4 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted"
    >
      {children}
    </button>
  );
}

/**
 * The dashed pill that adds somebody who has not joined.
 *
 * Opens into a name field in place rather than a dialog over the sheet: this
 * is one field on the way to finishing an entry, and a modal on top of a modal
 * is a second thing to dismiss before getting back to what you were doing.
 *
 * Stays open while the request is in flight and closes when the person
 * exists, so a slow network reads as "still working" rather than as a field
 * that swallowed a name.
 */
function AddGuestPill({
  onAdd,
  label,
}: {
  onAdd: (name: string) => Promise<void>;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap-target inline-flex h-10 items-center gap-2 rounded-full border border-dashed border-border pr-3 pl-1 text-sm font-normal text-muted-foreground transition-colors hover:bg-muted"
      >
        <span
          aria-hidden="true"
          className="grid size-[30px] shrink-0 place-items-center rounded-full border border-dashed border-border"
        >
          <Plus className="size-4" />
        </span>
        <span className="truncate">{label}</span>
      </button>
    );
  }

  const submit = async () => {
    const trimmed = name.trim();
    // Guarded here and not only by the disabled attribute: a keyboard Enter
    // reaches this whatever the button looks like.
    if (trimmed === "" || saving) return;
    setSaving(true);
    try {
      await onAdd(trimmed);
      setName("");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder={label}
        aria-label={label}
        maxLength={120}
        className="h-10 w-40"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={name.trim() === "" || saving}
        aria-label={label}
        className="tap-target grid size-10 shrink-0 place-items-center rounded-full border border-border bg-white/4 text-muted-foreground disabled:opacity-50"
      >
        <Check aria-hidden="true" className="size-4" />
      </button>
    </span>
  );
}
