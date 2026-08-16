"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RemindSheet } from "./remind-sheet";
import type { RemindRecipient } from "@/modules/reminders/types";

/**
 * The entry point to the Remind flow, and the memory of having used it.
 *
 * Once everyone who could be reminded has been, within the last 24 hours, the
 * button stops being an action and becomes a statement: "Reminded", disabled.
 * That is the whole of the confirmation — there is deliberately no read
 * receipt, because nothing in the system can prove a message was seen.
 */
export function RemindButton({
  groupId,
  groupName,
  senderName,
  recipients,
}: {
  groupId: string;
  groupName: string;
  senderName: string;
  recipients: readonly RemindRecipient[];
}) {
  const t = useTranslations("remind");
  const [open, setOpen] = useState(false);

  const actionable = recipients.filter((recipient) => !recipient.locked);

  if (actionable.length === 0) {
    return (
      <Button
        variant="outline"
        aria-disabled="true"
        disabled
        size="lg"
        className="h-9 rounded-xl px-3.5 text-sm font-medium"
      >
        <Check aria-hidden="true" className="size-4" />
        {t("reminded")}
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="lg"
        onClick={() => setOpen(true)}
        className="h-9 rounded-xl px-3.5 text-sm font-medium"
      >
        <Bell aria-hidden="true" className="size-4" />
        {t("action")}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        {/* The sheet closes from the X in the step's own header, where the
            design puts it, so the floating one would be a second control on
            top of the first. */}
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="mx-auto max-h-[90svh] max-w-[390px] gap-0 overflow-y-auto rounded-t-[28px] bg-background px-5 pt-2.5 pb-[22px] data-[side=bottom]:border-t-0"
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
