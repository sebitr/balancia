"use client";

import { Check } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * The small controls the split sheet is built from.
 *
 * Every one of them is a toggle, and they all say so the same way: a tick and
 * a coral edge mean selected. Making them look alike was the mistake in the
 * old checkbox list — everything was a row, so nothing said whether tapping it
 * would select or act — but the answer was one honest shape, not two.
 *
 * Two colours, because there are two questions on that sheet and a person can
 * be an answer to both. Coral is "in the split"; amber is "put the money in".
 * If the payer were coral as well, the one person who is usually both would be
 * indistinguishable from everybody else on a screen whose entire job is to
 * tell those two roles apart.
 */

export interface EntryMember {
  readonly id: string;
  readonly displayName: string;
}

/** Which of the sheet's two questions a control is answering. */
export type PillTone = "primary" | "payer";

const AVATAR_TONE: Record<PillTone, string> = {
  primary: "bg-primary text-primary-foreground",
  payer: "bg-payer text-payer-foreground",
};

const PILL_TONE: Record<PillTone, string> = {
  primary: "border-primary bg-primary/15",
  payer: "border-payer bg-payer/15",
};

const TICK_TONE: Record<PillTone, string> = {
  primary: "text-primary",
  payer: "text-payer",
};

/** First letter of a name, for the avatar. */
export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

export function MemberAvatar({
  name,
  className,
  selected = false,
  tone = "primary",
}: {
  name: string;
  className?: string;
  /** Selected avatars take their tone's colour, so a face reads as chosen. */
  selected?: boolean;
  tone?: PillTone;
}) {
  return (
    <Avatar className={cn("size-[30px] shrink-0", className)}>
      <AvatarFallback
        className={cn(
          "text-xs font-semibold",
          selected ? AVATAR_TONE[tone] : "bg-accent text-accent-foreground",
        )}
      >
        {initialOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * A person, chosen or not.
 *
 * `choice` is the one-of-many form — who paid — and reports itself as a radio
 * so that a screen reader says "1 of 4" rather than announcing four
 * independent toggles that happen to be mutually exclusive.
 */
export function MemberPill({
  name,
  label,
  selected,
  onToggle,
  disabled = false,
  tone = "primary",
  choice = false,
}: {
  name: string;
  /** Accessible name, where the visible one would not be distinct enough. */
  label?: string;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  tone?: PillTone;
  /** One of many, rather than an independent toggle. */
  choice?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      role={choice ? "radio" : undefined}
      aria-checked={choice ? selected : undefined}
      aria-pressed={choice ? undefined : selected}
      aria-label={label}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full border pr-3 pl-1 text-sm transition-colors disabled:pointer-events-none disabled:opacity-50",
        selected
          ? cn(PILL_TONE[tone], "font-semibold text-foreground")
          : "border-border bg-white/4 font-normal text-muted-foreground",
      )}
    >
      <MemberAvatar name={name} selected={selected} tone={tone} />
      <span className="truncate">{name}</span>
      {selected && (
        <Check
          aria-hidden="true"
          className={cn("size-4 shrink-0", TICK_TONE[tone])}
        />
      )}
    </button>
  );
}

/**
 * A member pill without the member.
 *
 * Same shape and same tap target, for choices that are one-of-many rather than
 * people — categories, mostly. It keeps the sheets feeling like one family
 * instead of introducing a third kind of small control.
 */
export function ChoicePill({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm transition-colors",
        selected
          ? "border-primary bg-primary/15 font-semibold text-foreground"
          : "border-border bg-white/4 font-normal text-muted-foreground",
      )}
    >
      {children}
      {selected && (
        <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
      )}
    </button>
  );
}
