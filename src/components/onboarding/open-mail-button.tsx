"use client";

import { useSyncExternalStore } from "react";
import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SECONDARY } from "./screens";

/**
 * A way into the inbox, on the phones that have one to open.
 *
 * A code is read in a mail app and typed back into this tab, and the trip
 * between the two is where people are lost: the tab is behind the mail app,
 * or the mail app is three swipes away. iOS opens Mail for `message://`, and
 * Android opens whichever app is registered for mail for the intent below.
 * A desktop has no single mail app to open, so there the button is not drawn
 * rather than drawn and disappointing.
 *
 * Which mail app opens is the platform's choice, not ours; Gmail on an iPhone
 * still needs a tap. That is a limit of the phone, and the button says "your
 * email app" rather than promising a name.
 */

type Phone = "ios" | "android" | null;

const subscribe = (): (() => void) => () => {};

function phoneOf(): Phone {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(agent)) return "ios";
  if (/Android/.test(agent)) return "android";
  return null;
}

const HREF: Record<Exclude<Phone, null>, string> = {
  ios: "message://",
  android:
    "intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.APP_EMAIL;end",
};

export function OpenMailButton({ className }: { className?: string }) {
  const t = useTranslations("onboarding.identity");
  const phone = useSyncExternalStore(subscribe, phoneOf, () => null);
  if (!phone) return null;

  return (
    <Button
      asChild
      size="lg"
      variant="outline"
      className={className ?? SECONDARY}
    >
      <a href={HREF[phone]}>
        <Mail aria-hidden="true" className="size-4" />
        {t("openMail")}
      </a>
    </Button>
  );
}
