"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PROVIDER_NAMES } from "@/modules/backup/providers";
import type { DestinationView, RunView } from "@/modules/backup/service";
import { errorCopy } from "@/components/backup/error-copy";
import { reconnectTarget } from "./reconnect";

/**
 * What a person must hear before anything else on the screen, drawn above it.
 *
 * Two things earn it. A revoked connection, which stops every backup until the
 * person acts and is not retried on its own; and a run of failures, which the
 * server *is* retrying but which has gone on long enough to stop being a
 * hiccup. Both are destructive alerts: they say "this is not working", which is
 * exactly what that ink is spoken for.
 *
 * The action sits under the text, not at the corner. `AlertAction` is absolute
 * and reserves a column on the right, which on a 362px card would leave the
 * sentence about 220px to wrap in; under the text it has the whole width.
 *
 * Each alert owns the screen's one filled button where it has to: for a
 * revoked connection it is Reconnect, and "Back up now" is switched off until
 * then; for failures "Back up now" still works and stays the filled one, so
 * "See details" is the quiet one.
 */
export function BackupBanner({
  destination,
  failedRun,
  onDetails,
}: {
  destination: DestinationView;
  /** The most recent run that failed, whose words the banner repeats. */
  failedRun: RunView | null;
  /** Opens that run in History. */
  onDetails: () => void;
}) {
  const t = useTranslations("cloudBackup");
  const provider = PROVIDER_NAMES[destination.provider];

  if (destination.attention === "reconnect") {
    // The app, not the person's access, is what the provider turned away: a
    // new secret, a deleted app. Reconnecting through the same one would end
    // the same way, so this goes to the wizard to be given new details.
    const appRefused = failedRun?.errorCode === "app";
    const target = reconnectTarget(destination.provider, destination.id, {
      appRefused,
    });
    const copy = errorCopy(t, "app", provider);
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>{t("attention.revokedTitle", { provider })}</AlertTitle>
        <AlertDescription>
          {appRefused
            ? `${copy.sentence} ${copy.hint ?? ""}`.trim()
            : t("attention.revoked")}
        </AlertDescription>
        <div className="col-start-2 mt-2.5">
          <Button asChild size="sm" className="font-semibold">
            {target.kind === "oauth" ? (
              // A plain anchor: see `reconnect.ts` for why it cannot be a Link.
              <a href={target.href}>{t("attention.reconnect")}</a>
            ) : (
              <Link href={target.href}>{t("attention.reconnect")}</Link>
            )}
          </Button>
        </div>
      </Alert>
    );
  }

  if (destination.attention === "failing") {
    const copy = errorCopy(t, failedRun?.errorCode, provider);
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>
          {t("attention.failedTitle", {
            count: destination.consecutiveFailures,
          })}
        </AlertTitle>
        <AlertDescription>
          {copy.sentence}
          {copy.hint && ` ${copy.hint}`}
        </AlertDescription>
        {failedRun && (
          <div className="col-start-2 mt-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDetails}
              className="text-foreground"
            >
              {t("attention.details")}
            </Button>
          </div>
        )}
      </Alert>
    );
  }

  return null;
}
