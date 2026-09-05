"use client";

import { Check } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { initialOf } from "./initials";

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
  /**
   * Somebody in the group's money but not on the instance.
   *
   * A guest is a full member of the balance maths — owed to, owing from,
   * settleable — so nothing about the split treats them differently. The ring
   * is only so you can see at a glance who has not joined, which is the fact
   * somebody needs when they wonder why a person never gets reminders.
   */
  readonly guest?: boolean;
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
  primary: "text-primary-ink",
  payer: "text-payer-ink",
};

export function MemberAvatar({
  name,
  className,
  selected = false,
  tone = "primary",
  guest = false,
}: {
  name: string;
  className?: string;
  /** Selected avatars take their tone's colour, so a face reads as chosen. */
  selected?: boolean;
  tone?: PillTone;
  /** Draws the dashed ring that says this person has not joined. */
  guest?: boolean;
}) {
  return (
    <Avatar
      className={cn(
        "size-[30px] shrink-0",
        // Dashed for the same reason the "Someone else" row's circle is:
        // there is a person here, but no account behind them yet.
        guest && "border border-dashed border-border",
        className,
      )}
    >
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
  guest = false,
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
  /** Draws the dashed ring that says this person has not joined. */
  guest?: boolean;
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
        "tap-target inline-flex h-10 items-center gap-2 rounded-full border pr-3 pl-1 text-sm transition-colors disabled:pointer-events-none disabled:opacity-50",
        selected
          ? cn(PILL_TONE[tone], "font-semibold text-foreground")
          : "border-border bg-wash-1 font-normal text-muted-foreground",
      )}
    >
      <MemberAvatar name={name} selected={selected} tone={tone} guest={guest} />
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
 *
 * With an `icon` it takes the member pill's other half too: the glyph sits in
 * the tile an avatar would occupy, and fills with coral when chosen. The tick
 * goes away in that form — the filled tile already says "this one", and a pill
 * carrying both reads as two separate marks for one piece of state.
 */
export function ChoicePill({
  children,
  selected,
  onClick,
  icon: Icon,
  trailing,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  /** Drawn in a 32px tile at the leading edge, the way a face would be. */
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /**
   * A mark at the trailing edge — a chevron, where the pill leads somewhere
   * rather than only choosing. Not a hit target of its own: the whole pill
   * goes wherever the chevron promises.
   */
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "tap-target inline-flex h-10 items-center gap-2 rounded-full border text-sm transition-colors",
        Icon ? "pr-4 pl-1" : "px-4",
        selected
          ? "border-primary bg-primary/15 font-semibold text-foreground"
          : "border-border bg-wash-1 font-normal text-muted-foreground",
      )}
    >
      {Icon && (
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full",
            selected
              ? "bg-primary text-primary-foreground"
              : "bg-wash-2 text-muted-foreground",
          )}
        >
          <Icon aria-hidden={true} className="size-[18px]" />
        </span>
      )}
      <span className="truncate">{children}</span>
      {trailing}
      {selected && !Icon && (
        <Check
          aria-hidden="true"
          className="size-4 shrink-0 text-primary-ink"
        />
      )}
    </button>
  );
}
