"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A link that resolves to nothing: revoked, expired, or never real.
 *
 * Rendered by the flow itself rather than reached by a redirect, because
 * finishing the flow spends the cookie the link lived in — so the page that
 * re-renders after a Server Action would redirect somebody who had just
 * succeeded. Held in the flow's own first-render state, this can only be seen
 * by somebody who never got started.
 */
export function DeadLinkScreen() {
  const t = useTranslations("joinError");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-5 px-5 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Info aria-hidden="true" className="size-6" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl leading-tight font-semibold tracking-[-0.02em] text-pretty">
          {t("reasons.invalid.title")}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {t("reasons.invalid.body")}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild variant="outline">
          <Link href="/">{t("home")}</Link>
        </Button>
        <Button asChild>
          <Link href="/sign-in">{t("signIn")}</Link>
        </Button>
      </div>
    </div>
  );
}
