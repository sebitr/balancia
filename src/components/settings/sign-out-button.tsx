"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmSheet } from "./confirm-sheet";
import { signOutAction } from "@/modules/auth/actions";

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
 * The Account screen offers the same thing from its danger card, with its own
 * sheet: see `danger-card.tsx`. They share the copy and the action rather than
 * the component, because one is a centred word and the other is a row with an
 * icon, and threading a `variant` through to say so would be the longer way to
 * write both.
 */
export function SignOutButton() {
  const t = useTranslations("userSettings");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto mt-1 shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {t("signOut")}
      </button>

      <ConfirmSheet
        open={open}
        onOpenChange={setOpen}
        title={t("signOutTitle")}
        body={t("signOutBody")}
        confirmLabel={t("signOut")}
        // The action revokes the session, clears the cookie and redirects, so
        // there is nothing to close afterwards — the page it would have closed
        // onto is gone.
        onConfirm={() => signOutAction()}
      />
    </>
  );
}
