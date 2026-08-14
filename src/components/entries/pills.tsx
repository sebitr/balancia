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
 */

export interface EntryMember {
  readonly id: string;
  readonly displayName: string;
}

/** First letter of a name, for the avatar. */
export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

export function MemberAvatar({
  name,
  className,
  selected = false,
}: {
  name: string;
  className?: string;
  /** Selected avatars go coral, so a face reads as chosen at a glance. */
  selected?: boolean;
}) {
  return (
    <Avatar className={cn("size-[30px] shrink-0", className)}>
      <AvatarFallback
        className={cn(
          "text-xs font-semibold",
          selected
            ? "bg-primary text-primary-foreground"
            : "bg-accent text-accent-foreground",
        )}
      >
        {initialOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** A toggle: this person is, or is not, part of the split. */
export function MemberPill({
  name,
  label,
  selected,
  onToggle,
  disabled = false,
}: {
  name: string;
  /** Accessible name, where the visible one would not be distinct enough. */
  label?: string;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={label}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full border pr-3 pl-1 text-sm transition-colors disabled:pointer-events-none disabled:opacity-50",
        selected
          ? "border-primary bg-primary/15 font-semibold text-foreground"
          : "border-border bg-white/4 font-normal text-muted-foreground",
      )}
    >
      <MemberAvatar name={name} selected={selected} />
      <span className="truncate">{name}</span>
      {selected && (
        <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
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
