"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Bell, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RemindSheet } from "./remind-sheet";
import type { RemindRecipient } from "@/modules/reminders/types";
import { cn } from "@/lib/utils";

/**
 * The entry point to the Remind flow, and the memory of having used it.
 *
 * Once everyone who could be reminded has been, within the last 24 hours, the
 * button stops being an action and becomes a statement, disabled: "Reminded
 * Katherine · 2 hours ago", or "Reminded 2 people · 5 hours ago". Who and when
 * are the two things a reader needs to decide whether to chase again, and the
 * recipients already carry both. There is deliberately no read receipt,
 * because nothing in the system can prove a message was seen.
 *
 * The cooldown is the recipients' `locked` flag, set by the server's 24-hour
 * rule; this component only reads it.
 */
export function RemindButton({
  groupId,
  groupName,
  senderName,
  recipients,
  label,
  ariaLabel,
  variant = "outline",
  className,
  now,
  showNames = true,
}: {
  groupId: string;
  groupName: string;
  senderName: string;
  recipients: readonly RemindRecipient[];
  /** Overview cards can name one person or say "all" more precisely. */
  label?: string;
  /**
   * What the button is called when the row it sits in is not there to say it.
   *
   * The settle screen's rows carry a bare "Remind", because the line above
   * names the person; a screen reader running the controls on their own gets
   * this instead, which names them too.
   */
  ariaLabel?: string;
  variant?: "default" | "outline";
  className?: string;
  /**
   * The server's clock, as an ISO string, so "2 hours ago" is worked out
   * against the same instant on both sides of hydration. Without it the
   * client's own clock at first render is used.
   */
  now?: string;
  /**
   * Whether the reminded state names who. Where the line above the button
   * already names the person (the settle screen), it says only when.
   */
  showNames?: boolean;
}) {
  const t = useTranslations("remind");
  const format = useFormatter();
  const [mountedAt] = useState(() => new Date());
  const [open, setOpen] = useState(false);

  const actionable = recipients.filter((recipient) => !recipient.locked);

  if (actionable.length === 0) {
    const state = remindedState(recipients);
    const when = state.latest
      ? format.relativeTime(state.latest, now ? new Date(now) : mountedAt)
      : null;
    const text = !when
      ? t("reminded")
      : showNames
        ? t("remindedState", {
            count: state.names.length,
            name: state.names[0] ?? "",
            when,
          })
        : t("lockedSince", { when });
    return (
      <Button
        variant="outline"
        aria-disabled="true"
        disabled
        size="lg"
        // Wraps rather than truncating: a name and a time are the point.
        className={cn(
          "h-auto min-h-9 rounded-xl px-3.5 py-1.5 text-left text-sm leading-snug font-medium whitespace-normal",
          className,
        )}
      >
        <Check aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0">{text}</span>
      </Button>
    );
  }

  return (
    <>
      <Button
        variant={variant}
        size="lg"
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
        className={cn("h-9 rounded-xl px-3.5 text-sm font-medium", className)}
      >
        <Bell aria-hidden="true" className="size-4" />
        {label ?? t("action")}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        {/* The sheet closes from the X in the step's own header, where the
            design puts it, so the floating one would be a second control on
            top of the first. */}
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="mx-auto max-h-[90svh] max-w-[390px] gap-0 overflow-y-auto rounded-t-[28px] bg-background px-5 pb-[22px] data-[side=bottom]:border-t-0"
        >
          {/* The step's own heading is the sheet's title — a second, hidden
              one would only make a screen reader say it twice. */}
          <RemindSheet
            groupId={groupId}
            groupName={groupName}
            senderName={senderName}
            recipients={recipients}
            onDone={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * Who was reminded and when it last happened, among those still locked.
 * Names are distinct, so two debts to one person read as one person.
 */
export function remindedState(recipients: readonly RemindRecipient[]): {
  names: string[];
  latest: Date | null;
} {
  const reminded = recipients.filter((r) => r.lastRemindedAt !== null);
  const names = [...new Set(reminded.map((r) => r.name))];
  const times = reminded.map((r) => new Date(r.lastRemindedAt as string));
  const latest = times.length
    ? new Date(Math.max(...times.map((d) => d.getTime())))
    : null;
  return { names, latest };
}
