"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The one string every assistant needs, with a button to copy it.
 *
 * The button says "Copied" on itself rather than in a toast: the control moved
 * and stayed moved, and the clipboard is the thing that changed. A browser that
 * refuses the clipboard leaves the address on screen and selectable, which is
 * the fallback rather than an error worth a toast.
 */
export function CopyAddress({ address }: { address: string }) {
  const t = useTranslations("agentAccess");
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-2">
      <label
        htmlFor="agent-address"
        className="block text-xs font-medium text-muted-foreground"
      >
        {t("addressLabel")}
      </label>
      {/* Stacked on a phone: beside a button that says "Copy address" the field
          shows eleven characters of an address that is thirty long. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        {/* `Input` already carries `text-base md:text-sm`; the address is
            read-only but selectable, so a tap selects all of it. */}
        <Input
          id="agent-address"
          readOnly
          value={address}
          onFocus={(event) => event.currentTarget.select()}
          className="h-10 sm:flex-1 md:h-8"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void onCopy()}
          aria-label={t("copy")}
          className="h-10 shrink-0 md:h-8"
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  );
}
