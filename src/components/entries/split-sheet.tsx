"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { SplitMethod } from "@/modules/expenses/split";
import type {
  SplitMessage,
  SplitPreview,
} from "@/components/expenses/expense-form-logic";
import { MemberAvatar, MemberPill, type EntryMember } from "./pills";

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
  received = false,
  splitText,
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
  /** Income was received and credited, not paid and owed. */
  received?: boolean;
  /** Renders a message from the pure split logic. */
  splitText: (message: SplitMessage) => string;
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
        <SheetTitle className="text-[19px] font-semibold tracking-[-0.02em]">
          {title}
        </SheetTitle>
        <span className="text-sm text-muted-foreground tabular-nums">
          {totalFormatted}
        </span>
      </div>

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {t(received ? "receivedBy" : "paidBy")}
        </h3>
        <div className="flex gap-2">
          {members.map((member) => {
            const active = member.id === payerId;
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => onPayerChange(member.id)}
                aria-pressed={active}
                // Both halves of this sheet carry a control per person. The
                // shapes tell them apart on screen; these names do it for
                // anyone who is not looking at the screen.
                aria-label={t(received ? "receiverOption" : "payerOption", {
                  name: member.displayName,
                })}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1.5 rounded-xl border p-2.5 transition-colors",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border bg-white/4",
                )}
              >
                <MemberAvatar
                  name={member.displayName}
                  className="size-[34px]"
                  selected={active}
                />
                <span
                  className={cn(
                    "truncate text-xs",
                    active
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {member.displayName}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        {/* No "Everyone" / "Just me" shortcuts: everyone is already the state
            this sheet opens in, and the pills below reach either end in a tap
            or two. Two more controls that mostly restate the selection cost
            more attention than they save. */}
        <h3 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
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
            />
          ))}
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
              "h-9 flex-1 rounded-[calc(var(--radius-xl)_-_--spacing(1))] text-[13px] transition-colors",
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

      <ul className="overflow-hidden rounded-[14px] bg-white/4">
        {members
          .filter((member) => includedIds.includes(member.id))
          .map((member) => {
            const allocation = allocationFor(member.id);
            return (
              <li
                key={member.id}
                className="flex items-center gap-3 border-b border-white/8 p-3 last:border-b-0"
              >
                <MemberAvatar name={member.displayName} selected />
                <span className="flex-1 truncate text-[15px]">
                  {member.displayName}
                </span>

                {method !== "equal" && (
                  <Input
                    inputMode="decimal"
                    aria-label={t(`inputLabels.${method}`, {
                      name: member.displayName,
                    })}
                    className="h-9 w-[72px] text-right tabular-nums"
                    placeholder={method === "shares" ? "1" : "0"}
                    value={values[member.id] ?? ""}
                    onChange={(event) =>
                      onValueChange(member.id, event.target.value)
                    }
                  />
                )}

                <span className="w-[70px] text-right text-[15px] tabular-nums">
                  {allocation?.formatted ?? "—"}
                </span>
              </li>
            );
          })}
      </ul>

      {!preview.ok && preview.error && (
        <p className="text-[13px] text-negative">{splitText(preview.error)}</p>
      )}
      {preview.ok && preview.roundingNote && (
        <p className="text-[13px] text-muted-foreground">
          {splitText(preview.roundingNote)}
        </p>
      )}

      <Button type="button" size="lg" className="h-13" onClick={onDone}>
        {t("done")}
      </Button>
    </div>
  );
}
