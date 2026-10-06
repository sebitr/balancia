"use client";

import { useTranslations } from "next-intl";
import { useQueuedCount } from "@/components/offline/use-online";
import { ConfirmSheet } from "./confirm-sheet";
import { signOut } from "./sign-out";

/**
 * The question signing out asks, wherever it is asked from.
 *
 * Shared by the hub's text button and the Account screen's danger row, which
 * differ in how they look and in nothing they say or do. It used to be two
 * copies of the same sheet; the warning below is what made one worth having,
 * since a warning kept in two places is a warning that one of them loses.
 */
export function SignOutSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("userSettings");

  return (
    <ConfirmSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("signOutTitle")}
      body={t("signOutBody")}
      confirmLabel={t("signOut")}
      cancelLabel={t("signOutCancel")}
      // Clears this device, ends the session and redirects, so there is
      // nothing to close afterwards — the page it would have closed onto is
      // gone. See `signOut`.
      onConfirm={signOut}
    >
      <UnsentWarning />
    </ConfirmSheet>
  );
}

/**
 * How many entries signing out would throw away, when there are any.
 *
 * Signing out deletes the device's offline store, and the outbox is in it:
 * expenses typed with no network that have not reached the server yet exist
 * nowhere else. That is the one thing on this device a person would want back,
 * so the sheet says so before the tap rather than after — and "Stay signed in"
 * is right under it, the way to keep them until they have gone.
 *
 * Mounted only while the sheet is open, so the count is read when it is
 * asked for and not on every visit to settings. Every entry on the device is
 * counted, whoever typed it, because every one of them is about to go.
 */
function UnsentWarning() {
  const t = useTranslations("userSettings");
  const count = useQueuedCount();
  if (count === 0) return null;

  return (
    <p
      role="alert"
      className="text-xs leading-relaxed text-pretty text-destructive"
    >
      {t("signOutUnsent", { count })}
    </p>
  );
}
