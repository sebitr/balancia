"use client";

import { useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What a screen says when it could not be drawn.
 *
 * A plain message and a way to try again. The underlying error is logged to
 * the browser console for a developer, never rendered — a stack trace on
 * screen can leak internals — and only its digest is shown, which is what an
 * operator needs to find the matching line in the server's log.
 *
 * Shared by every `error.tsx`, which differ only in where they sit: the root
 * one owns the whole screen, while the group's and settings' sit inside the
 * chrome their layouts already drew, so the header, the tab bar and the way
 * back are still there around the message. Those two are why this takes a
 * `className` and an optional `children` — the room it is given, and whatever
 * way out the surrounding chrome does not already offer — and why the heading
 * can be left to a header that already says it.
 *
 * `retry` rather than `reset`: a screen that failed on the server fails again
 * if it is only re-rendered from what the browser already has, and `retry`
 * fetches it again. That is what "Try again" promises.
 */
export function RouteError({
  error,
  retry,
  className,
  titled = true,
  children,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  className?: string;
  /** False where the chrome around this already carries the heading. */
  titled?: boolean;
  /** A second way out, beside "Try again". */
  children?: ReactNode;
}) {
  const t = useTranslations("errorBoundary");
  const tCommon = useTranslations("common");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 px-4 text-center",
        className,
      )}
    >
      {titled && (
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
      )}
      <p className="max-w-md text-pretty text-muted-foreground">{t("body")}</p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          {t("reference", { digest: error.digest })}
        </p>
      )}
      <div className="flex gap-3">
        <Button onClick={retry}>{tCommon("retry")}</Button>
        {children}
      </div>
    </div>
  );
}
