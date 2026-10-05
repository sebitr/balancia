"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SignOutSheet } from "./sign-out-sheet";

/**
 * Signing out, from the foot of the hub.
 *
 * A text button rather than a filled one: it is the last thing on a long
 * screen, it is not what anybody came for, and a coral bar across the bottom
 * of settings would read as the thing to do next.
 *
 * It asks first. Signing out is not destructive, but it is the one action here
 * with no way back — Undo lives in a toast, and the toast would be raised into
 * a page nobody is signed in to any more. Two taps is the honest price.
 *
 * The Account screen offers the same thing from its danger card: see
 * `danger-card.tsx`. They share the sheet and everything it does, and not the
 * trigger, because one is a centred word and the other is a row with an icon,
 * and threading a `variant` through to say so would be the longer way to write
 * both.
 */
export function SignOutButton() {
  const t = useTranslations("userSettings");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto mt-1 shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-primary-ink transition-colors hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {t("signOut")}
      </button>

      <SignOutSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
